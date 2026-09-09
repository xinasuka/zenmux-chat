package cc.cd.zenchat;

import android.content.res.AssetManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends BridgeActivity {

    private WebResourceResponse handleLocalOnnxAsset(WebResourceRequest request) {
        if (request == null || request.getUrl() == null) {
            return null;
        }
        Uri url = request.getUrl();
        String path = url.getPath();
        if (path != null && path.startsWith("/assets/onnx/")) {
            try {
                AssetManager am = getAssets();
                String assetPath = "public" + path;
                InputStream stream = am.open(assetPath);

                String mime = "application/octet-stream";
                if (path.endsWith(".js")) {
                    mime = "application/javascript";
                } else if (path.endsWith(".wasm")) {
                    mime = "application/wasm";
                } else if (path.endsWith(".onnx")) {
                    mime = "application/octet-stream";
                }

                Map<String, String> headers = new HashMap<>();
                headers.put("Access-Control-Allow-Origin", "*");
                headers.put("Cache-Control", "public, max-age=31536000, immutable");

                return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, stream);
            } catch (Exception ignored) {
                // Fall back to default network resolution if local asset cannot be read
            }
        }
        return null;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);

        // 1. Intercept main WebView requests for /assets/onnx/* to serve directly from APK assets
        getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse localResponse = handleLocalOnnxAsset(request);
                if (localResponse != null) {
                    return localResponse;
                }
                return super.shouldInterceptRequest(view, request);
            }
        });

        // 2. Intercept Service Worker fetch requests for /assets/onnx/* (Android N+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            try {
                ServiceWorkerController swController = ServiceWorkerController.getInstance();
                swController.setServiceWorkerClient(new ServiceWorkerClient() {
                    @Override
                    public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                        WebResourceResponse localResponse = handleLocalOnnxAsset(request);
                        if (localResponse != null) {
                            return localResponse;
                        }
                        return getBridge().getLocalServer().shouldInterceptRequest(request);
                    }
                });
            } catch (Exception ignored) {}
        }
    }
}

