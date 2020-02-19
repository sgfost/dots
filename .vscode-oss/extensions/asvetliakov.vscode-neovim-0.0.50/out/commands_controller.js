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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vscode_1 = __importDefault(require("vscode"));
class CommandsController {
    constructor(client) {
        this.disposables = [];
        this.sendToVim = (keys) => {
            this.client.input(keys);
        };
        this.ctrlAInsert = () => __awaiter(this, void 0, void 0, function* () {
            // Insert previously inserted text from the insert mode
            const editor = vscode_1.default.window.activeTextEditor;
            if (!editor) {
                return;
            }
            const lines = yield this.client.callFunction("VSCodeGetLastInsertText");
            if (!lines.length) {
                return;
            }
            yield editor.edit(b => b.insert(editor.selection.active, lines.join("\n")));
        });
        this.client = client;
        this.disposables.push(vscode_1.default.commands.registerCommand("vscode-neovim.ctrl-a-insert", this.ctrlAInsert));
        this.disposables.push(vscode_1.default.commands.registerCommand("vscode-neovim.send", key => this.sendToVim(key)));
        this.disposables.push(vscode_1.default.commands.registerCommand("vscode-neovim.paste-register", reg => this.pasteFromRegister(reg)));
    }
    dispose() {
        for (const d of this.disposables) {
            d.dispose();
        }
    }
    pasteFromRegister(registerName) {
        return __awaiter(this, void 0, void 0, function* () {
            // copy content from register in insert mode
            const editor = vscode_1.default.window.activeTextEditor;
            if (!editor) {
                return;
            }
            const content = yield this.client.callFunction("VSCodeGetRegister", [registerName]);
            if (content === "") {
                return;
            }
            yield editor.edit(b => b.insert(editor.selection.active, content));
        });
    }
}
exports.CommandsController = CommandsController;
//# sourceMappingURL=commands_controller.js.map