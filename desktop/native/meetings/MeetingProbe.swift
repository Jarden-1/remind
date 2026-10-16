import AppKit
import ApplicationServices

// Read only allowlisted applications' action controls. Never emit titles, names,
// participant lists, chat text or audio. AX does not activate or manipulate windows.
func matches(_ value: String, _ prefixes: [String]) -> Bool {
    let text = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    return prefixes.contains { text == $0 || text.hasPrefix($0 + " ") || text.hasPrefix($0 + "（") || text.hasPrefix($0 + "(") || text.hasPrefix($0 + "，") }
}
func flags(_ labels: [String]) -> (end: Bool, audio: Bool, video: Bool, share: Bool) {
    return (
      labels.contains { matches($0, ["离开会议", "结束会议", "退出会议", "离开通话", "结束通话", "挂断", "挂断通话", "leave meeting", "end meeting", "leave call", "end call", "hang up"]) },
      labels.contains { matches($0, ["静音", "取消静音", "麦克风", "开启麦克风", "关闭麦克风", "mute", "unmute", "microphone"]) },
      labels.contains { matches($0, ["开启视频", "关闭视频", "摄像头", "开启摄像头", "关闭摄像头", "start video", "stop video", "camera"]) },
      labels.contains { matches($0, ["共享屏幕", "停止共享", "共享", "分享屏幕", "share screen", "stop sharing", "share"]) }
    )
}
func isMeeting(_ labels: [String]) -> Bool {
    let f = flags(labels)
    let leave = labels.contains { matches($0, ["离开", "leave"]) }
    return (f.end && (f.audio || f.video || f.share)) || (leave && f.audio && (f.video || f.share))
}
// Tencent 3.46 uses Qt/NX controls without standard button names. Its AX identifiers
// expose an exact in-meeting page route; preview, waiting-room and end dialogs are excluded.
func inMeetingRoute(_ identifier: String) -> Bool {
    return ["inmeeting", "inmeeting_revision", "inmeeting_secondary_wnd", "inmeeting_revision_float_child_window", "inmeeting_share_toolbar_window"].contains { identifier.contains("wemeet://page/" + $0 + ".") }
}

func selfTest() {
    precondition(isMeeting(["离开会议", "取消静音"]))
    precondition(isMeeting(["Leave meeting", "Mute"]))
    precondition(!isMeeting(["加入会议", "麦克风"]))
    precondition(!isMeeting(["录制语音", "麦克风"]))
    precondition(!isMeeting(["离开会议的注意事项", "麦克风"]))
    precondition(!isMeeting(["离开", "静音"]))
    precondition(isMeeting(["离开", "静音", "关闭摄像头"]))
    precondition(inMeetingRoute("QApplication.wemeet://page/inmeeting_revision.DialogWidget"))
    precondition(!inMeetingRoute("QApplication.wemeet://page/inmeeting_revision_end_meeting.DialogWidget"))
    precondition(!inMeetingRoute("QApplication.wemeet://page/inmeeting/waitingroom.DialogWidget"))

}

func attribute(_ element: AXUIElement, _ name: String) -> (AXError, CFTypeRef?) {
    AXUIElementSetMessagingTimeout(element, 0.1)
    var value: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, name as CFString, &value)
    return (error, value)
}
func inspect(_ app: NSRunningApplication, deadline: Date) -> String {
    let root = AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(root, 0.15)
    let (error, value) = attribute(root, kAXWindowsAttribute)
    guard error == .success, let windows = value as? [AXUIElement], !windows.isEmpty else { return "unknown" }
    var uncertain = false
    var visited = 0
    for window in windows {
        var labels: [String] = [], stack: [(AXUIElement, Int)] = [(window, 0)]
        if attribute(window, kAXMinimizedAttribute).1 as? Bool == true { uncertain = true }
        while let (element, depth) = stack.popLast() {
            visited += 1
            if visited > 2500 || Date() > deadline { return "unknown" }
            let (roleError, roleValue) = attribute(element, kAXRoleAttribute)
            if roleError != .success { uncertain = true; continue }
            if app.bundleIdentifier?.hasPrefix("com.tencent.") == true,
               let identifier = attribute(element, kAXIdentifierAttribute).1 as? String, inMeetingRoute(identifier) { return "active" }
            if let role = roleValue as? String, [kAXButtonRole, kAXCheckBoxRole, kAXPopUpButtonRole, kAXMenuButtonRole].contains(role) {
                for key in [kAXTitleAttribute, kAXDescriptionAttribute, kAXHelpAttribute] {
                    if let label = attribute(element, key).1 as? String, label.count <= 128 { labels.append(label) }
                }
            }
            let (childError, childValue) = attribute(element, kAXChildrenAttribute)
            if childError == .cannotComplete || childError == .invalidUIElement { uncertain = true }
            if let children = childValue as? [AXUIElement] {
                if depth < 24 { stack.append(contentsOf: children.map { ($0, depth + 1) }) }
                else if !children.isEmpty { uncertain = true }
            }
        }
        if isMeeting(labels) { return "active" }
        if labels.isEmpty { uncertain = true }
        // Missing controls are not an end signal when a mini meeting bar is the only visible UI.
        if labels.contains(where: { matches($0, ["返回会议", "回到会议", "return to meeting", "back to meeting"]) }) { uncertain = true }
    }
    return uncertain ? "unknown" : "inactive"
}
func snapshot() throws -> String {
let deadline = Date().addingTimeInterval(2.3)
var trusted = AXIsProcessTrusted()
let allowlist: [(String, [String])] = [
    ("tencent-meeting", ["com.tencent.meeting", "com.tencent.tencentmeeting", "com.tencent.wemeet"]),
    ("feishu", ["com.bytedance.Lark", "com.electron.lark", "com.larksuite.lark"])
]
let running = NSWorkspace.shared.runningApplications
// A trust flag can remain stale after the Settings toggle changes. Only a
// successful protected read from an allowlisted app can confirm effective access.
if !trusted {
    let bundles = allowlist.flatMap { $0.1 }
    for app in running where bundles.contains(app.bundleIdentifier ?? "") {
        let root = AXUIElementCreateApplication(app.processIdentifier)
        if attribute(root, kAXWindowsAttribute).0 == .success { trusted = true; break }
    }
}
let records: [[String: Any]] = allowlist.map { id, bundles in
    let apps = running.filter { app in guard let bundle = app.bundleIdentifier else { return false }; return bundles.contains(bundle) }
    var status = apps.isEmpty ? "inactive" : trusted ? "inactive" : "unknown"
    if trusted {
        for app in apps {
            let observed = inspect(app, deadline: deadline)
            if observed == "active" { status = "active"; break }
            if observed == "unknown" { status = "unknown" }
        }
    }
    var record: [String: Any] = ["id": id, "status": status]
    if let app = apps.first, let url = app.bundleURL, let version = Bundle(url: url)?.infoDictionary?["CFBundleShortVersionString"] as? String { record["version"] = String(version.prefix(64)) }
    return record
}
let data = try JSONSerialization.data(withJSONObject: ["protocol": 1, "permission": trusted ? "granted" : "required", "apps": records], options: [.sortedKeys])
return String(decoding: data, as: UTF8.self)
}

// Loaded into remind itself: TCC evaluates the app the user authorized, not a
// separate executable. The Node wrapper runs this bounded scan off the UI thread.
@_cdecl("remind_meeting_snapshot")
public func nativeSnapshot() -> UnsafeMutablePointer<CChar>? {
    autoreleasepool { try? strdup(snapshot()) }
}
@_cdecl("remind_meeting_free")
public func nativeFree(_ value: UnsafeMutablePointer<CChar>?) { free(value) }
@_cdecl("remind_meeting_self_test")
public func nativeSelfTest() { selfTest() }
