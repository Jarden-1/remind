using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Automation;

// UIA metadata only: no activation, input injection, recording or content export.
class MeetingProbe {
    static DateTime deadline;
    static bool Matches(string value, string[] prefixes) {
        string text = (value ?? "").Trim().ToLowerInvariant();
        foreach (string prefix in prefixes) if (text == prefix || text.StartsWith(prefix + " ") || text.StartsWith(prefix + "（") || text.StartsWith(prefix + "(") || text.StartsWith(prefix + "，")) return true;
        return false;
    }
    static bool Has(List<string> labels, params string[] values) { return labels.Exists(label => Matches(label, values)); }
    static bool InMeetingRoute(string value) {
        if (value == null) return false;
        foreach (var route in new[]{"inmeeting","inmeeting_revision","inmeeting_secondary_wnd","inmeeting_revision_float_child_window","inmeeting_share_toolbar_window"}) if (value.Contains("wemeet://page/" + route + ".")) return true;
        return false;
    }
    static bool IsMeeting(List<string> labels) {
        bool audio = Has(labels,"静音","取消静音","麦克风","开启麦克风","关闭麦克风","mute","unmute","microphone");
        bool video = Has(labels,"开启视频","关闭视频","摄像头","开启摄像头","关闭摄像头","start video","stop video","camera");
        bool share = Has(labels,"共享屏幕","停止共享","共享","分享屏幕","share screen","stop sharing","share");
        return (Has(labels,"离开会议","结束会议","退出会议","离开通话","结束通话","挂断","挂断通话","leave meeting","end meeting","leave call","end call","hang up") && (audio || video || share)) || (Has(labels,"离开","leave") && audio && (video || share));
    }
    delegate bool WindowCallback(IntPtr hwnd, IntPtr param);
    [DllImport("user32.dll")] static extern bool EnumWindows(WindowCallback callback, IntPtr param);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    static string Inspect(HashSet<int> pids, bool tencent) {
        bool active = false, uncertain = false, found = false;
        int visited = 0;
        EnumWindows(delegate(IntPtr hwnd, IntPtr param) {
            uint pid; GetWindowThreadProcessId(hwnd, out pid);
            if (!pids.Contains((int)pid)) return true;
            if (!IsWindowVisible(hwnd) && !IsIconic(hwnd)) return true;
            found = true;
            if (IsIconic(hwnd) || !IsWindowVisible(hwnd)) uncertain = true;
            try {
                var root = AutomationElement.FromHandle(hwnd);
                var stack = new Stack<Tuple<AutomationElement,int>>(); stack.Push(Tuple.Create(root,0));
                var labels = new List<string>();
                var walker = TreeWalker.ControlViewWalker;
                while (stack.Count > 0) {
                    var item = stack.Pop();
                    if (++visited > 2500 || DateTime.UtcNow > deadline) { uncertain = true; break; }
                    var current = item.Item1.Current;
                    if (tencent && InMeetingRoute(current.AutomationId)) { active = true; break; }
                    if (current.ControlType == ControlType.Button || current.ControlType == ControlType.CheckBox || current.ControlType == ControlType.MenuItem) {
                        if (current.Name != null && current.Name.Length <= 128) labels.Add(current.Name);
                        if (current.HelpText != null && current.HelpText.Length <= 128) labels.Add(current.HelpText);
                    }
                    var child = walker.GetFirstChild(item.Item1);
                    if (child != null && item.Item2 >= 24) { uncertain = true; continue; }
                    while (child != null) {
                        stack.Push(Tuple.Create(child,item.Item2 + 1)); child = walker.GetNextSibling(child);
                        if (++visited > 2500 || DateTime.UtcNow > deadline) { uncertain = true; break; }
                    }
                }
                if (IsMeeting(labels)) active = true;
                if (labels.Count == 0) uncertain = true;
                if (Has(labels,"返回会议","回到会议","return to meeting","back to meeting")) uncertain = true;
            } catch { uncertain = true; }
            return !active && DateTime.UtcNow < deadline;
        }, IntPtr.Zero);
        return active ? "active" : !found || uncertain ? "unknown" : "inactive";
    }
    [MTAThread] static int Main(string[] args) {
        Console.OutputEncoding = new UTF8Encoding(false);
        if (Array.IndexOf(args,"--self-test") >= 0) {
            if (!IsMeeting(new List<string>{"离开会议","取消静音"}) || IsMeeting(new List<string>{"加入会议","麦克风"}) || IsMeeting(new List<string>{"离开会议的注意事项","麦克风"}) || !InMeetingRoute("QApplication.wemeet://page/inmeeting_revision.DialogWidget") || InMeetingRoute("QApplication.wemeet://page/inmeeting_revision_end_meeting.DialogWidget")) return 1;
            if (IsMeeting(new List<string>{"离开","静音"}) || !IsMeeting(new List<string>{"离开","静音","关闭摄像头"})) return 1;
            Console.WriteLine("meeting-probe self-test passed"); return 0;
        }
        deadline = DateTime.UtcNow.AddSeconds(2.3);
        var records = new List<object>();
        var groups = new Dictionary<string,string[]> { {"tencent-meeting",new[]{"TencentMeeting","WeMeetApp","wemeetapp"}}, {"feishu",new[]{"Feishu","Lark","FeishuMeetings","Lark Meetings"}} };
        foreach (var group in groups) {
            var pids = new HashSet<int>(); bool failed = false;
            foreach (string name in group.Value) try { foreach (var process in Process.GetProcessesByName(name)) { pids.Add(process.Id); process.Dispose(); } } catch { failed = true; }
            records.Add(new { id = group.Key, status = failed ? "unknown" : pids.Count == 0 ? "inactive" : Inspect(pids, group.Key == "tencent-meeting") });
        }
        Console.Write(new JavaScriptSerializer().Serialize(new { protocol = 1, permission = "granted", apps = records }));
        return 0;
    }
}
