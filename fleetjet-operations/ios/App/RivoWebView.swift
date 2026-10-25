import SwiftUI
import WebKit
import UIKit

struct RivoWebView: UIViewRepresentable {
    let tracker: TrackingController
    func makeCoordinator() -> Coordinator { Coordinator(tracker: tracker) }
    func makeUIView(context: Context) -> WKWebView {
        let view = tracker.webView
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = true
        if view.url == nil { view.load(URLRequest(url: URL(string: "https://app.floraljet.llc/my-mileage")!)) }
        return view
    }
    func updateUIView(_ uiView: WKWebView, context: Context) { }

    @MainActor final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
        let tracker: TrackingController
        init(tracker: TrackingController) { self.tracker = tracker }
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { decisionHandler(.cancel); return }
            if TrackingPolicy.trusted(url) { decisionHandler(action.shouldPerformDownload ? .download : .allow); return }
            decisionHandler(.cancel)
            // Only user-activated public links leave the app. No arbitrary schemes or redirects.
            if action.navigationType == .linkActivated && ["https", "mailto", "tel", "sms"].contains(url.scheme ?? "") {
                UIApplication.shared.open(url)
            }
        }
        func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                     decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
            let attachment = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")?.lowercased().contains("attachment") == true
            decisionHandler(response.canShowMIMEType && !attachment ? .allow : .download)
        }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { Task { await tracker.refreshIdentity(force: true) } }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            guard (error as NSError).code != NSURLErrorCancelled else { return }
            tracker.errorMessage = "The trip-review page is offline. Native recording can continue if it was already enabled."
        }
        private func presenter() -> UIViewController? {
            guard var view = tracker.webView.window?.rootViewController else { return nil }
            while let presented = view.presentedViewController { view = presented }
            return view.isBeingDismissed || view is UIAlertController ? nil : view
        }
        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            guard frame.request.url.map(TrackingPolicy.trusted) == true, let view = presenter() else { completionHandler(); return }
            let alert = UIAlertController(title: "Rivo", message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
            view.present(alert, animated: true)
        }
        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            guard frame.request.url.map(TrackingPolicy.trusted) == true, let view = presenter() else { completionHandler(false); return }
            let alert = UIAlertController(title: "Rivo", message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
            alert.addAction(UIAlertAction(title: "Continue", style: .default) { _ in completionHandler(true) })
            view.present(alert, animated: true)
        }
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            guard let url = action.request.url else { return nil }
            if TrackingPolicy.trusted(url) { webView.load(action.request) }
            else if action.navigationType == .linkActivated && ["https", "mailto", "tel", "sms"].contains(url.scheme ?? "") { UIApplication.shared.open(url) }
            return nil
        }
        func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
        func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
        func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                      suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
            do {
                let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                let name = URL(fileURLWithPath: suggestedFilename).lastPathComponent
                let destination = folder.appendingPathComponent(name.isEmpty ? "rivo-report.csv" : name)
                destinations[ObjectIdentifier(download)] = destination
                completionHandler(destination)
            } catch { completionHandler(nil); tracker.errorMessage = "The report could not be saved on this phone." }
        }
        var destinations: [ObjectIdentifier: URL] = [:]
        func downloadDidFinish(_ download: WKDownload) {
            guard let file = destinations.removeValue(forKey: ObjectIdentifier(download)),
                  let root = tracker.webView.window?.rootViewController else { return }
            var presenter = root
            while let presented = presenter.presentedViewController { presenter = presented }
            let share = UIActivityViewController(activityItems: [file], applicationActivities: nil)
            share.popoverPresentationController?.sourceView = tracker.webView
            presenter.present(share, animated: true)
        }
        func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
            destinations.removeValue(forKey: ObjectIdentifier(download)); tracker.errorMessage = "Report download failed. Please try again online."
        }
        func download(_ download: WKDownload, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                      decisionHandler: @escaping (WKDownload.RedirectPolicy) -> Void) {
            decisionHandler(request.url.map(TrackingPolicy.trusted) == true ? .allow : .cancel)
        }
    }
}
