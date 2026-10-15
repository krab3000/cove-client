import Cocoa
import FlutterMacOS

class MainFlutterWindow: NSWindow {
  override func awakeFromNib() {
    let flutterViewController = FlutterViewController()
    self.contentViewController = flutterViewController

    // The tablet layout (design 1n: 1180×820, landscape); narrower down to its portrait (820 wide)
    self.setContentSize(NSSize(width: 1180, height: 820))
    self.contentMinSize = NSSize(width: 820, height: 600)
    self.center()

    RegisterGeneratedPlugins(registry: flutterViewController)

    super.awakeFromNib()
  }
}
