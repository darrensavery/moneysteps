package com.morechard.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Android WebView ignores the system "Font size" accessibility setting by
        // default (textZoom is fixed at 100 regardless of Configuration.fontScale).
        // Mirror the OS setting onto the WebView so all app text scales with it.
        float fontScale = getResources().getConfiguration().fontScale;
        getBridge().getWebView().getSettings().setTextZoom(Math.round(fontScale * 100));
    }
}
