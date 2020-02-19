"use strict";
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const vscode = __importStar(require("vscode"));
class StatusLineController {
    constructor() {
        this.modeItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
        this.commandItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 5);
        this.msgItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1);
    }
    set modeString(str) {
        if (!str) {
            this.modeItem.hide();
        }
        else {
            this.modeItem.text = str;
            this.modeItem.show();
        }
    }
    set statusString(str) {
        if (!str) {
            this.commandItem.hide();
        }
        else {
            this.commandItem.text = str;
            this.commandItem.show();
        }
    }
    set msgString(str) {
        if (!str) {
            this.msgItem.hide();
        }
        else {
            this.msgItem.text = str;
            this.msgItem.show();
        }
    }
    dispose() {
        this.commandItem.dispose();
        this.modeItem.dispose();
        this.msgItem.dispose();
    }
}
exports.StatusLineController = StatusLineController;
//# sourceMappingURL=status_line.js.map