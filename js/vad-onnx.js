// js/vad-onnx.js
// Client-Side Deep Neural Voice Activity Detection (Silero VAD v5 via ONNX Runtime Web).
// Evaluates temporal and spectral phoneme dynamics with near-total immunity to mechanical
// noise artifacts (keyboard typing, background chatter, paper rustling, air conditioning).

const MODEL_PATH = '/assets/onnx/silero_vad.onnx';
const ORT_SCRIPT_PATH = '/assets/onnx/ort.min.js';
const WASM_DIR_PATH = '/assets/onnx/';
const VAD_CACHE_BUCKET = 'zenchat-onnx-vad-v1';

class SileroVADEngine {
  constructor() {
    this.status = 'unloaded'; // 'unloaded' | 'loading' | 'ready' | 'error'
    this.errorMessage = null;
    this.loadPromise = null;
    this.session = null;
    this.stateTensor = null;
    this.srTensor = null;
    this.sampleBuffer = new Float32Array(0);

    // VAD decision parameters (Silero v5 standard parameters)
    this.sampleRate = 16000;
    this.windowSize = 512; // 512 samples @ 16kHz = 32ms per inference step
    this.positiveThreshold = 0.50; // Threshold above which speech is considered active
    this.negativeThreshold = 0.35; // Hysteresis threshold below which speech ceases
    this.redemptionFrames = 3;     // Micro-pause tolerance (3 frames = ~96ms)
    this.missedSpeechFrames = 0;
    this.isSpeechActive = false;
    this.lastProbability = 0;
  }

  /**
   * Ascertains whether the ONNX neural model has been initialized and is ready for inference.
   */
  isReady() {
    return this.status === 'ready' && this.session !== null;
  }

  /**
   * Dynamically loads the ONNX Runtime Web script into the document if absent.
   */
  async _loadOrtScript() {
    if (typeof window !== 'undefined' && window.ort && window.ort.InferenceSession) {
      return window.ort;
    }

    return new Promise((resolve, reject) => {
      // Check if a script tag is already being appended
      const existing = document.querySelector(`script[src="${ORT_SCRIPT_PATH}"]`);
      if (existing) {
        if (window.ort) return resolve(window.ort);
        existing.addEventListener('load', () => resolve(window.ort));
        existing.addEventListener('error', (err) => reject(new Error(`Failed to load ${ORT_SCRIPT_PATH}: ${err}`)));
        return;
      }

      const script = document.createElement('script');
      script.src = ORT_SCRIPT_PATH;
      script.async = true;
      script.onload = () => {
        if (window.ort) {
          resolve(window.ort);
        } else {
          reject(new Error('ORT loaded but window.ort is undefined'));
        }
      };
      script.onerror = (err) => reject(new Error(`Network error loading ${ORT_SCRIPT_PATH}`));
      document.head.appendChild(script);
    });
  }

  /**
   * Fetches the quantized Silero V5 ONNX model weights with persistent CacheStorage hydration.
   */
  async _fetchModelBuffer(onProgress) {
    // 1. Attempt retrieval from dedicated CacheStorage bucket
    if (typeof window !== 'undefined' && 'caches' in window) {
      try {
        const cache = await window.caches.open(VAD_CACHE_BUCKET);
        const cachedResponse = await cache.match(MODEL_PATH);
        if (cachedResponse) {
          if (onProgress) onProgress({ status: 'cached', percent: 80 });
          const buffer = await cachedResponse.arrayBuffer();
          return new Uint8Array(buffer);
        }
      } catch (cacheErr) {
        console.warn('[VAD-ONNX] CacheStorage inspection warning:', cacheErr);
      }
    }

    // 2. Fetch from same-origin static assets
    if (onProgress) onProgress({ status: 'downloading', percent: 20 });
    const res = await fetch(MODEL_PATH);
    if (!res.ok) {
      throw new Error(`Failed to download VAD model from ${MODEL_PATH}: HTTP ${res.status}`);
    }

    // Cache the response asynchronously for subsequent zero-latency offline loads
    if (typeof window !== 'undefined' && 'caches' in window) {
      try {
        const cache = await window.caches.open(VAD_CACHE_BUCKET);
        cache.put(MODEL_PATH, res.clone()).catch(() => {});
      } catch (_) {}
    }

    if (onProgress) onProgress({ status: 'downloading', percent: 70 });
    const buffer = await res.arrayBuffer();
    return new Uint8Array(buffer);
  }

  /**
   * Asynchronously warms up and compiles the Silero VAD session.
   * Invoked upon user selecting the ONNX option in Settings or initiating voice capture.
   */
  async loadModel(onProgress) {
    if (this.status === 'ready') {
      if (onProgress) onProgress({ status: 'ready', percent: 100 });
      return true;
    }

    if (this.status === 'loading' && this.loadPromise) {
      return this.loadPromise;
    }

    this.status = 'loading';
    this.errorMessage = null;

    this.loadPromise = (async () => {
      try {
        if (onProgress) onProgress({ status: 'loading-runtime', percent: 10 });
        const ort = await this._loadOrtScript();

        // Configure single-threaded WebAssembly execution (broadest compatibility, no COOP/COEP required)
        ort.env.wasm.wasmPaths = WASM_DIR_PATH;
        ort.env.wasm.numThreads = 1;
        ort.env.logLevel = 'error';

        // Retrieve model binary buffer
        const modelData = await this._fetchModelBuffer(onProgress);

        if (onProgress) onProgress({ status: 'compiling', percent: 90 });

        // Instantiate inference session
        this.session = await ort.InferenceSession.create(modelData, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all'
        });

        // Initialize state context tensors
        this.resetState();

        this.status = 'ready';
        if (onProgress) onProgress({ status: 'ready', percent: 100 });
        console.log('[VAD-ONNX] Silero VAD v5 Neural Engine successfully initialized.');
        return true;
      } catch (err) {
        this.status = 'error';
        this.errorMessage = err.message || String(err);
        console.error('[VAD-ONNX] Initialization failure:', err);
        if (onProgress) onProgress({ status: 'error', error: this.errorMessage });
        throw err;
      } finally {
        this.loadPromise = null;
      }
    })();

    return this.loadPromise;
  }

  /**
   * Resets the recurrent LSTM hidden context and accumulator buffer.
   */
  resetState() {
    this.sampleBuffer = new Float32Array(0);
    this.missedSpeechFrames = 0;
    this.isSpeechActive = false;
    this.lastProbability = 0;
    this._queue = Promise.resolve();

    if (typeof window !== 'undefined' && window.ort) {
      // Silero v5 state: float32 context tensor of dimensions [2, 1, 128] initialized to zeros
      const zeroes = new Float32Array(2 * 1 * 128);
      this.stateTensor = new window.ort.Tensor('float32', zeroes, [2, 1, 128]);
      // Sample rate scalar tensor
      this.srTensor = new window.ort.Tensor('int64', BigInt64Array.from([16000n]), []);
    }
  }

  /**
   * Ingests a 16kHz audio slice, accumulates samples into 512-sample frames (32ms),
   * and runs stateful recurrent neural network inference.
   * Serializes session.run execution to preclude concurrent WebAssembly re-entrancy.
   *
   * @param {Float32Array} frame16k - Newly received 16kHz audio samples
   * @returns {Promise<{ isSpeech: boolean, probability: number }>}
   */
  async process(frame16k) {
    if (!this.isReady()) {
      throw new Error('SileroVADEngine is not ready');
    }

    // 1. Synchronously accumulate incoming samples to buffer
    const merged = new Float32Array(this.sampleBuffer.length + frame16k.length);
    merged.set(this.sampleBuffer, 0);
    merged.set(frame16k, this.sampleBuffer.length);
    this.sampleBuffer = merged;

    // 2. Chain processing onto serialized promise to eliminate re-entrancy collisions
    this._queue = (this._queue || Promise.resolve()).then(async () => {
      let maxProb = this.lastProbability;

      while (this.sampleBuffer.length >= this.windowSize) {
        const windowChunk = this.sampleBuffer.subarray(0, this.windowSize);
        this.sampleBuffer = this.sampleBuffer.subarray(this.windowSize);

        const inputTensor = new window.ort.Tensor('float32', windowChunk, [1, this.windowSize]);
        const inputs = {
          input: inputTensor,
          state: this.stateTensor,
          sr: this.srTensor
        };

        try {
          const out = await this.session.run(inputs);
          if (out.stateN) {
            this.stateTensor = out.stateN;
          }
          if (out.output && out.output.data) {
            const prob = out.output.data[0];
            this.lastProbability = prob;
            if (prob > maxProb) {
              maxProb = prob;
            }

            // Dynamic Hysteresis State Machine
            if (prob >= this.positiveThreshold) {
              this.isSpeechActive = true;
              this.missedSpeechFrames = 0;
            } else if (prob < this.negativeThreshold) {
              if (this.isSpeechActive) {
                this.missedSpeechFrames++;
                if (this.missedSpeechFrames >= this.redemptionFrames) {
                  this.isSpeechActive = false;
                }
              }
            }
          }
        } catch (inferenceErr) {
          console.warn('[VAD-ONNX] Inference step anomaly:', inferenceErr);
        }
      }

      return {
        isSpeech: this.isSpeechActive,
        probability: maxProb
      };
    });

    return this._queue;
  }
}

// Canonical singleton export
export const sileroVAD = new SileroVADEngine();
