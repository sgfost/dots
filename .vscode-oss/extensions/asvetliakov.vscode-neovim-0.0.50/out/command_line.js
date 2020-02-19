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
Object.defineProperty(exports, "__esModule", { value: true });
const vscode_1 = require("vscode");
const constants_1 = require("./constants");
class CommandLineController {
    constructor(client, callbacks) {
        this.isDisplayed = false;
        this.disposables = [];
        this.completionAllowed = false;
        this.completionItems = [];
        this.mode = "";
        this.ignoreHideEvent = false;
        this.onAccept = () => {
            if (!this.isDisplayed) {
                return;
            }
            this.callbacks.onAccepted();
        };
        this.onChange = (e) => {
            if (!this.isDisplayed) {
                return;
            }
            const mode = this.mode;
            if (mode === ":" && (e.charAt(0) === "?" || e.charAt(0) === "/") && this.input.items.length) {
                this.input.items = [];
                this.completionItems = [];
            }
            const useCompletion = mode === ":" && e.charAt(0) !== "?" && e.charAt(0) !== "/";
            this.callbacks.onChanged(e, useCompletion);
        };
        this.onHide = () => {
            if (!this.isDisplayed) {
                return;
            }
            this.clean();
            if (this.ignoreHideEvent) {
                this.ignoreHideEvent = false;
                return;
            }
            this.callbacks.onCanceled();
        };
        this.processCompletionTimer = () => {
            this.completionAllowed = true;
            if (this.isDisplayed && this.completionItems.length) {
                this.input.items = this.completionItems;
            }
            this.completionTimer = undefined;
        };
        this.deleteAll = () => {
            if (!this.isDisplayed) {
                return;
            }
            this.input.value = "";
            this.onChange("");
        };
        this.deleteChar = () => {
            if (!this.isDisplayed) {
                return;
            }
            this.input.value = this.input.value.slice(0, -1);
            this.onChange(this.input.value);
        };
        this.deleteWord = () => {
            if (!this.isDisplayed) {
                return;
            }
            this.input.value = this.input.value
                .trimRight()
                .split(" ")
                .slice(0, -1)
                .join(" ");
            this.onChange(this.input.value);
        };
        this.acceptSelection = () => {
            if (!this.isDisplayed) {
                return;
            }
            const sel = this.input.activeItems[0];
            if (!sel) {
                return;
            }
            this.input.value = this.input.value
                .split(" ")
                .slice(0, -1)
                .concat(sel.label)
                .join(" ");
            this.onChange(this.input.value);
        };
        this.onHistoryUp = () => __awaiter(this, void 0, void 0, function* () {
            yield this.neovimClient.input("<Up>");
            const res = yield this.neovimClient.callFunction("getcmdline", []);
            if (res) {
                this.input.value = res;
            }
        });
        this.onHistoryDown = () => __awaiter(this, void 0, void 0, function* () {
            yield this.neovimClient.input("<Down>");
            const res = yield this.neovimClient.callFunction("getcmdline", []);
            if (res) {
                this.input.value = res;
            }
        });
        this.neovimClient = client;
        this.callbacks = callbacks;
        this.input = vscode_1.window.createQuickPick();
        this.input.ignoreFocusOut = true;
        this.disposables.push(this.input.onDidAccept(this.onAccept));
        this.disposables.push(this.input.onDidChangeValue(this.onChange));
        this.disposables.push(this.input.onDidHide(this.onHide));
        this.disposables.push(vscode_1.commands.registerCommand("vscode-neovim.delete-word-left-cmdline", this.deleteWord));
        this.disposables.push(vscode_1.commands.registerCommand("vscode-neovim.delete-all-cmdline", this.deleteAll));
        this.disposables.push(vscode_1.commands.registerCommand("vscode-neovim.delete-char-left-cmdline", this.deleteChar));
        this.disposables.push(vscode_1.commands.registerCommand("vscode-neovim.history-up-cmdline", this.onHistoryUp));
        this.disposables.push(vscode_1.commands.registerCommand("vscode-neovim.history-down-cmdline", this.onHistoryDown));
        this.disposables.push(vscode_1.commands.registerCommand("vscode-neovim.complete-selection-cmdline", this.acceptSelection));
    }
    show(initialContent = "", mode, prompt = "") {
        if (!this.isDisplayed) {
            this.input.value = "";
            this.isDisplayed = true;
            this.input.value = "";
            this.mode = mode;
            this.input.title = prompt || this.getTitle(mode);
            this.input.show();
            // display content after cmdline appears - otherwise it will be preselected that is not good when calling from visual mode
            if (initialContent) {
                this.input.value = initialContent;
            }
            // Display completions only after 1.5secons, so it won't bother for simple things like ":w" or ":noh"
            this.completionAllowed = false;
            this.completionItems = [];
            this.input.items = [];
            this.completionTimer = setTimeout(this.processCompletionTimer, 1500);
            // breaks mappings with command line mode, e.g. :call stuff()
            // this.onChange(this.input.value);
        }
        else {
            const newTitle = prompt || this.getTitle(mode);
            if (newTitle !== this.input.title) {
                this.input.title = newTitle;
            }
            // we want take content for the search modes, because <c-l>/<c-w><c-r> keybindings
            if (this.mode === "/" || this.mode === "?") {
                this.input.value = initialContent;
            }
        }
    }
    setCompletionItems(items) {
        this.completionItems = items.map(i => ({ label: i, alwaysShow: true }));
        if (this.completionAllowed) {
            this.input.items = this.completionItems;
        }
    }
    cancel(ignoreHideEvent = false) {
        this.ignoreHideEvent = ignoreHideEvent;
        this.input.hide();
    }
    dispose() {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.input.dispose();
    }
    getTitle(modeOrPrompt) {
        switch (modeOrPrompt) {
            case "/":
                return `${constants_1.GlyphChars.SEARCH_FORWARD} Forward Search:`;
            case "?":
                return `${constants_1.GlyphChars.SEARCH_BACKWARD} Backward Search:`;
            case ":":
                return `${constants_1.GlyphChars.COMMAND} VIM Command Line:`;
            default:
                return modeOrPrompt;
        }
    }
    clean() {
        if (this.completionTimer) {
            clearTimeout(this.completionTimer);
        }
        this.isDisplayed = false;
        this.input.value = "";
        this.input.title = "";
        this.mode = "";
        this.completionAllowed = false;
        this.input.items = [];
        this.completionItems = [];
    }
}
exports.CommandLineController = CommandLineController;
//# sourceMappingURL=command_line.js.map