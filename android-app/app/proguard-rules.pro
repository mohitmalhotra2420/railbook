# RailBook Assist — keep JS bridge interface names
-keepclassmembers class com.railbook.assist.RailBookJsBridge {
    @android.webkit.JavascriptInterface <methods>;
}
