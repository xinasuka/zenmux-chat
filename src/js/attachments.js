// js/attachments.js
// Client-side Canvas image resampler, text/code extractor, PDF parser, and attachment tray rendering.

import { uid, formatSize } from './state.js';
import { t } from './i18n.js';

export const ImageProcessor = {
  MAX_DIMENSION: 1600,
  JPEG_QUALITY: 0.82,
  MAX_FILE_SIZE_MB: 15,

  processFile(file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type || file.type.indexOf('image/') !== 0) {
        return reject(new Error(t('attachments.invalidImageFormat')));
      }
      if (file.size > this.MAX_FILE_SIZE_MB * 1024 * 1024) {
        return reject(new Error(t('attachments.imageTooLarge', { max: this.MAX_FILE_SIZE_MB })));
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const originalWidth = img.naturalWidth || img.width;
          const originalHeight = img.naturalHeight || img.height;
          let w = originalWidth;
          let h = originalHeight;

          if (w > this.MAX_DIMENSION || h > this.MAX_DIMENSION) {
            if (w >= h) {
              h = Math.round((h * this.MAX_DIMENSION) / w);
              w = this.MAX_DIMENSION;
            } else {
              w = Math.round((w * this.MAX_DIMENSION) / h);
              h = this.MAX_DIMENSION;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, w, h);
          }

          const isSmallPng = file.type === 'image/png' && file.size < 250 * 1024;
          const mime = isSmallPng ? 'image/png' : 'image/jpeg';
          const dataUrl = canvas.toDataURL(mime, this.JPEG_QUALITY);

          const head = dataUrl.indexOf(',');
          const b64Len = dataUrl.length - (head >= 0 ? head + 1 : 0);
          const compSize = Math.round((b64Len * 3) / 4);

          resolve({
            id: uid(),
            type: 'image',
            name: file.name || 'image.jpg',
            ext: (file.name || '').split('.').pop().toLowerCase() || 'img',
            mimeType: mime,
            dataUrl: dataUrl,
            width: w,
            height: h,
            originalSize: file.size,
            size: compSize,
          });
        };
        img.onerror = () => reject(new Error(t('attachments.imageDecodeError')));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error(t('attachments.imageReadError')));
      reader.readAsDataURL(file);
    });
  },
};

export const FileTextExtractor = {
  MAX_CHARS: 100000,
  MAX_FILE_SIZE_MB: 10,

  isImageFile(file) {
    if (file.type && file.type.indexOf('image/') === 0) return true;
    const ext = (file.name || '').split('.').pop().toLowerCase();
    return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg'].indexOf(ext) !== -1;
  },

  processFile(file) {
    const ext = (file.name || '').split('.').pop().toLowerCase();
    if (file.size > this.MAX_FILE_SIZE_MB * 1024 * 1024) {
      return Promise.reject(new Error(t('attachments.fileTooLarge', { max: this.MAX_FILE_SIZE_MB })));
    }
    if (ext === 'pdf') {
      return this.extractPdf(file);
    }
    return this.extractPlainText(file, ext);
  },

  extractPlainText(file, ext) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        let raw = e.target.result || '';
        let isTruncated = false;
        if (raw.length > this.MAX_CHARS) {
          raw = raw.slice(0, this.MAX_CHARS) + '\n\n' + t('attachments.truncatedText', { max: this.MAX_CHARS.toLocaleString() });
          isTruncated = true;
        }
        const lines = raw.split('\n').length;
        resolve({
          id: uid(),
          type: 'file',
          name: file.name,
          ext: ext || 'txt',
          text: raw,
          lines: lines,
          chars: raw.length,
          size: file.size,
          truncated: isTruncated,
        });
      };
      reader.onerror = () => reject(new Error(t('attachments.fileReadError')));
      reader.readAsText(file, 'utf-8');
    });
  },

  extractPdf(file) {
    return new Promise((resolve, reject) => {
      const doParse = (pdfjs) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const typedarray = new Uint8Array(e.target.result);
          pdfjs.getDocument(typedarray).promise.then((pdf) => {
            const maxPages = Math.min(pdf.numPages, 60);
            const pagePromises = [];
            for (let i = 1; i <= maxPages; i++) {
              pagePromises.push(pdf.getPage(i).then((page) => {
                return page.getTextContent().then((content) => {
                  return content.items.map((item) => item.str).join(' ');
                });
              }));
            }
            Promise.all(pagePromises).then((pagesText) => {
              let fullText = pagesText.map((tText, idx) => `${t('attachments.pdfPageHeader', { page: idx + 1 })}\n${tText}`).join('\n\n');
              if (fullText.length > this.MAX_CHARS) {
                fullText = fullText.slice(0, this.MAX_CHARS) + '\n\n' + t('attachments.truncatedPdf', { max: this.MAX_CHARS.toLocaleString() });
              }
              resolve({
                id: uid(),
                type: 'file',
                name: file.name,
                ext: 'pdf',
                text: fullText,
                lines: fullText.split('\n').length,
                chars: fullText.length,
                size: file.size,
                pages: pdf.numPages,
              });
            }).catch(reject);
          }).catch(reject);
        };
        reader.onerror = () => reject(new Error(t('attachments.pdfReadError')));
        reader.readAsArrayBuffer(file);
      };

      if (window.pdfjsLib) {
        doParse(window.pdfjsLib);
      } else {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        s.onload = () => {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          doParse(window.pdfjsLib);
        };
        s.onerror = () => reject(new Error(t('attachments.pdfJsError')));
        document.head.appendChild(s);
      }
    });
  },
};

export function renderAttachmentsTray(pendingAttachments, trayEl, onRemove, onOpenLightbox) {
  trayEl.innerHTML = '';
  if (!pendingAttachments.length) return;

  pendingAttachments.forEach((att, idx) => {
    let card;
    if (att.type === 'image') {
      card = document.createElement('div');
      card.className = 'attachment-card';
      const pic = document.createElement('img');
      pic.src = att.dataUrl;
      pic.alt = att.name;
      pic.title = `${att.name} (${formatSize(att.size)})`;
      pic.addEventListener('click', () => {
        if (typeof onOpenLightbox === 'function') onOpenLightbox(att.dataUrl);
      });
      card.appendChild(pic);
    } else {
      card = document.createElement('div');
      card.className = 'attachment-file-card';
      const badge = document.createElement('div');
      badge.className = 'file-icon-badge';
      badge.textContent = (att.ext || 'FILE').slice(0, 4).toUpperCase();

      const metaCol = document.createElement('div');
      metaCol.className = 'file-meta-col';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'file-name-text';
      nameSpan.textContent = att.name;
      nameSpan.title = att.name;

      const sizeSpan = document.createElement('span');
      sizeSpan.className = 'file-size-text';
      sizeSpan.textContent = formatSize(att.size) + (att.lines ? ` · ${t('chat.linesCount', { count: att.lines })}` : '');

      metaCol.appendChild(nameSpan);
      metaCol.appendChild(sizeSpan);
      card.appendChild(badge);
      card.appendChild(metaCol);
    }

    const del = document.createElement('button');
    del.className = 'attachment-del';
    del.textContent = '×';
    del.title = t('attachments.removeTooltip');
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof onRemove === 'function') onRemove(idx);
    });

    card.appendChild(del);
    trayEl.appendChild(card);
  });
}

export function processIncomingFiles(fileList, currentAttachments, canVision, onToast) {
  if (!fileList || !fileList.length) return Promise.resolve([]);
  let files = Array.prototype.slice.call(fileList);

  if (currentAttachments.length + files.length > 8) {
    if (onToast) onToast(t('attachments.maxFiles'), 'info');
    files = files.slice(0, 8 - currentAttachments.length);
  }

  const tasks = files.map((file) => {
    if (FileTextExtractor.isImageFile(file)) {
      if (!canVision) {
        if (onToast) onToast(t('attachments.unsupportedImage', { name: file.name }), 'info');
        return Promise.resolve(null);
      }
      return ImageProcessor.processFile(file).catch((err) => {
        if (onToast) onToast(t('attachments.imageFail', { name: file.name, error: err.message }), 'error');
        return null;
      });
    } else {
      return FileTextExtractor.processFile(file).catch((err) => {
        if (onToast) onToast(t('attachments.fileFail', { name: file.name, error: err.message }), 'error');
        return null;
      });
    }
  });

  return Promise.all(tasks).then((results) => results.filter(Boolean));
}
