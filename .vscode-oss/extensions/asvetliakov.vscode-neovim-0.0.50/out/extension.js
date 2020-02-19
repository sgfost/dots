"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const vscode = __importStar(require("vscode"));
const controller_1 = require("./controller");
const EXT_NAME = "vscode-neovim";
const EXT_ID = `asvetliakov.${EXT_NAME}`;
// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
function activate(context) {
    return __awaiter(this, void 0, void 0, function* () {
        const ext = vscode.extensions.getExtension(EXT_ID);
        const settings = vscode.workspace.getConfiguration(EXT_NAME);
        const neovimPath = process.env.NEOVIM_PATH || settings.get("neovimPath");
        if (!neovimPath) {
            vscode.window.showErrorMessage("Neovim: configure the path to neovim and restart the editor");
            return;
        }
        const highlightConfIgnore = settings.get("highlightGroups.ignoreHighlights");
        const highlightConfHighlights = settings.get("highlightGroups.highlights");
        const highlightConfUnknown = settings.get("highlightGroups.unknownHighlight");
        const mouseVisualSelection = settings.get("mouseSelectionStartVisualMode", false);
        const useCtrlKeysNormalMode = settings.get("useCtrlKeysForNormalMode", true);
        const useCtrlKeysInsertMode = settings.get("useCtrlKeysForInsertMode", true);
        const useWsl = settings.get("useWSL", false);
        const customInit = settings.get("neovimInitPath", "");
        vscode.commands.executeCommand("setContext", "neovim.ctrlKeysNormal", useCtrlKeysNormalMode);
        vscode.commands.executeCommand("setContext", "neovim.ctrlKeysInsert", useCtrlKeysInsertMode);
        const plugin = new controller_1.NVIMPluginController(neovimPath, context.extensionPath, {
            highlights: highlightConfHighlights,
            ignoreHighlights: highlightConfIgnore,
            unknownHighlight: highlightConfUnknown,
        }, mouseVisualSelection, ext.extensionKind === vscode.ExtensionKind.Workspace ? false : useWsl, customInit);
        context.subscriptions.push(plugin);
        yield plugin.init();
    });
}
exports.activate = activate;
// this method is called when your extension is deactivated
function deactivate() {
    // ignore
}
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map