import SwiftUI
import UIKit

@MainActor final class RivoAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // Also creates the manager for a system-delivered significant-location wake.
        // Tracking is restored only after verifying the existing consent and account.
        _ = TrackingController.shared
        return true
    }
}

@main struct RivoMileageApp: App {
    @UIApplicationDelegateAdaptor(RivoAppDelegate.self) var delegate
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var tracker = TrackingController.shared
    var body: some Scene {
        WindowGroup {
            DriverWorkspace(tracker: tracker)
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { Task { await tracker.refreshIdentity(force: true); await tracker.flush() } }
                }
        }
    }
}

struct DriverWorkspace: View {
    @ObservedObject var tracker: TrackingController
    @State private var showDisclosure = false
    @State private var showSettings = false
    @State private var logoRotation = 0.0
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image("RivoMark")
                    .resizable()
                    .renderingMode(.template)
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 24, height: 24)
                    .rotationEffect(.degrees(logoRotation))
                    .accessibilityHidden(true)
                    .onAppear {
                        guard !UIAccessibility.isReduceMotionEnabled else { return }
                        withAnimation(.linear(duration: 20).repeatForever(autoreverses: false)) {
                            logoRotation = 360
                        }
                    }
                Button { showSettings = true } label: {
                    Label(trackingLabel, systemImage: needsAttention ? "exclamationmark.circle" : tracker.isRecording ? "location.fill" : "location.slash")
                        .font(.subheadline)
                        .foregroundStyle(needsAttention ? Color.orange : .secondary)
                        .frame(minHeight: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Tracking status: " + tracker.status)
                .accessibilityHint("Opens tracking settings")
                Spacer(minLength: 8)
                Button { showSettings = true } label: {
                    Image(systemName: "gearshape").frame(width: 44, height: 44)
                }
                .accessibilityLabel("Settings")
            }
            .padding(.horizontal, 16)
            Divider()
            RivoWebView(tracker: tracker)
        }
        .tint(.accentColor)
        .preferredColorScheme(tracker.lightAppearance ? .light : .dark)
        .background(tracker.lightAppearance ? Color(red: 0.957, green: 0.969, blue: 0.984) : Color(red: 0.02, green: 0.02, blue: 0.025))
        .sheet(isPresented: $showSettings) {
            NavigationStack {
                Form {
                    Section("Display") {
                        Picker("Theme", selection: Binding(get: { tracker.appearanceMode }, set: { tracker.setAppearance($0) })) {
                            Text("Automatic").tag("auto")
                            Text("Light").tag("light")
                            Text("Dark").tag("dark")
                        }
                        Text("Automatic uses light from 7 am to 7 pm and dark overnight, in your local time.")
                    }
                    Section("Auto-track") {
                        Label(tracker.status, systemImage: tracker.isRecording ? "location.fill" : "location.slash")
                        autoTrackSwitch
                        Text("Enable once to record your drives automatically. Turn off to pause, including while offline.")
                        Button("Open iPhone permissions") {
                            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                        }
                    }
                    Section("Ready to record") {
                        LabeledContent("Account", value: tracker.session == nil ? "Sign in to My Mileage" : "Mileage profile connected")
                        LabeledContent("Background location", value: tracker.locationAccess)
                        LabeledContent("Precise location", value: tracker.preciseLocation ? "On" : "Turn on in Settings")
                        LabeledContent("GPS on this iPhone") {
                            if let fix = tracker.lastFix { Text(fix, style: .relative) }
                            else { Text("No fix this session") }
                        }
                        LabeledContent("Last GPS on server") {
                            if let fix = tracker.serverFix { Text(fix, style: .relative) }
                            else { Text("Not received yet") }
                        }
                        LabeledContent("Waiting to upload", value: "\(tracker.queuedFixes) GPS fixes")
                        Button("Check connection again") {
                            Task { await tracker.refreshIdentity(force: true); await tracker.flush(); await tracker.refreshQueueCount() }
                        }.disabled(tracker.busy)
                    }
                    Section("How it works") {
                        Text("Enable once while parked. Rivo records GPS in the background, including personal driving. Drives are detected automatically; choose Business or Personal later in Trips, then submit your weekly report.")
                        Text("Only submitted business mileage is shared with dispatch. During an assigned active delivery, fresh location is also shared on its live tracking map.")
                    }
                    Section("Tracking checks") {
                        Text("Always Location and Precise Location must remain enabled. The system location indicator shows when GPS is in use. Continuous GPS can increase battery use.")
                        Text("Force-quitting, signing out, disabling location, an expired session, low battery or missing GPS can interrupt capture. Reopen Rivo after a force-quit or reboot and check this status before driving.")
                        Text("Review Trips at the end of the week, choose Business or Personal, then submit your business report with your per-km rate.")
                        Text("Before relying on Rivo, compare a locked-screen drive with your odometer. Installation alone does not verify mileage accuracy.")
                        if let error = tracker.errorMessage { Text(error).foregroundStyle(.red) }
                    }
                }
                .navigationTitle("Settings")
                .preferredColorScheme(tracker.lightAppearance ? .light : .dark)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showSettings = false } } }
                .confirmationDialog("Enable automatic trip recording?", isPresented: $showDisclosure, titleVisibility: .visible) {
                    Button("Enable Auto-track") { Task { await tracker.enable() } }
                    Button("Cancel", role: .cancel) { }
                } message: {
                    Text("Rivo records personal and business drives while enabled, including with the screen locked. Review them later. Only submitted business mileage is shared with dispatch; active deliveries share live location. Turn this switch off to pause.")
                }
            }
        }
    }
    private var needsAttention: Bool {
        let staleGPS = tracker.lastFix.map { Date().timeIntervalSince($0) > 120 } ?? true
        return tracker.errorMessage != nil || (tracker.autoTrackEnabled && (!tracker.isRecording || staleGPS))
    }
    private var trackingLabel: String {
        needsAttention ? "Check tracking" : tracker.autoTrackEnabled ? "Tracking on" : "Tracking off"
    }

    private var autoTrackSwitch: some View {
        Toggle("Auto-track", isOn: Binding(get: { tracker.autoTrackEnabled }, set: { enabled in
            if enabled { showDisclosure = true }
            else { Task { await tracker.pause() } }
        }))
        .disabled(tracker.busy)
        .tint(.accentColor)
    }
}
