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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const vscode_1 = __importDefault(require("vscode"));
const neovim_1 = require("neovim");
const Buffer_1 = require("neovim/lib/api/Buffer");
const fast_diff_1 = __importDefault(require("fast-diff"));
const Utils = __importStar(require("./utils"));
const command_line_1 = require("./command_line");
const status_line_1 = require("./status_line");
const highlight_provider_1 = require("./highlight_provider");
const commands_controller_1 = require("./commands_controller");
// to not deal with screenrow positioning, we set height to high value and scrolloff to value / 2. so screenrow will be always constant
// big scrolloff is needed to make sure that editor visible space will be always within virtual vim boundaries, regardless of current
// cursor positioning
const NVIM_WIN_HEIGHT = 201;
const NVIM_WIN_WIDTH = 500;
const FIRST_SCREEN_LINE = 0;
const LAST_SCREEN_LINE = 200;
// set numberwidth=8
const NUMBER_COLUMN_WIDTH = 8;
class NVIMPluginController {
    constructor(neovimPath, extensionPath, highlightsConfiguration, mouseSelection, useWsl, customInit = "") {
        this.isInsertMode = false;
        this.isRecording = false;
        /**
         * Current vim mode
         */
        this.currentModeName = "";
        this.ignoreNextCursorUpdate = false;
        /**
         * Special flag to leave multiple cursors produced by visual line/visual block mode after
         * exiting visual mode. Being set by RPC request
         */
        this.leaveMultipleCursorsForVisualMode = false;
        this.disposables = [];
        /**
         * Enable visual mode selection by mouse
         */
        this.mouseSelectionEnabled = false;
        /**
         * All buffers ids originated from vscode
         */
        this.managedBufferIds = new Set();
        /**
         * Map of pending buffers which should become managed by vscode buffers. These are usually coming from jumplist
         * Since vim already created buffer for it, we must reuse it instead of creating new one
         */
        this.pendingBuffers = new Map();
        /**
         * Vscode uri string -> buffer mapping
         */
        this.uriToBuffer = new Map();
        /**
         * Buffer id -> vscode uri mapping
         */
        this.bufferIdToUri = new Map();
        /**
         * Skip buffer update from neovim with specified tick
         */
        this.skipBufferTickUpdate = new Map();
        /**
         * Track last changed version. Used to skip neovim update when in insert mode
         */
        this.documentLastChangedVersion = new Map();
        /**
         * Tracks changes in insert mode. We can send them to neovim immediately but this will break undo stack
         */
        this.documentChangesInInsertMode = new Map();
        this.documentText = new Map();
        /**
         * Vscode doesn't allow to apply multiple edits to the save document without awaiting previous reuslt.
         * So we'll accumulate neovim buffer updates here, then apply
         */
        this.pendingBufChangesQueue = [];
        /**
         * Neovim API states that multiple redraw batches could be sent following flush() after last batch
         * Save current batch into temp variable
         */
        this.currentRedrawBatch = [];
        /**
         * Vim modes
         */
        this.vimModes = new Map();
        this.nvimInitPromise = Promise.resolve();
        this.isInit = false;
        /**
         * Special flag to ignore mouse selection and don't send cursor event to neovim. Used for vscode-range-command RPC commands
         */
        this.shouldIgnoreMouseSelection = false;
        /**
         * When opening external buffers , like :PlugStatus they often comes with empty content and without name and receives text updates later
         * Don't want to clutter vscode by opening empty documents, so track them here and open only once when receiving some text
         */
        this.externalBuffersShowOnNextChange = new Set();
        /**
         * Pending cursor update. Indicates that editor should drop all cursor updates from neovim until it got the one indicated in [number, number]
         * We set it when switching the active editor
         * !seems not needed anymore
         */
        // private editorPendingCursor: WeakMap<
        //     vscode.TextEditor,
        //     { line: number; col: number; screenRow: number; totalSkips: number }
        // > = new WeakMap();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.noEditorBuffer = undefined;
        this.editorColumnIdToWinId = new Map();
        this.skipJumpsForUris = new Map();
        this.grids = new Map();
        this.numberLineHlId = 0;
        /**
         * Cursor updates originated through neovim or neovim changes. Key is the "line.col"
         */
        this.neovimCursorUpdates = new WeakMap();
        this.onChangeTextDocument = (e) => __awaiter(this, void 0, void 0, function* () {
            yield this.nvimInitPromise;
            const uri = e.document.uri.toString();
            const version = e.document.version;
            if (this.documentLastChangedVersion.get(uri) === version) {
                return;
            }
            // const eol = e.document.eol === vscode.EndOfLine.LF ? "\n" : "\r\n";
            const buf = this.uriToBuffer.get(uri);
            if (!buf) {
                return;
            }
            if (!this.managedBufferIds.has(buf.id)) {
                return;
            }
            const changed = this.documentChangesInInsertMode.get(uri);
            if (!changed) {
                this.documentChangesInInsertMode.set(uri, true);
            }
            if (!this.isInsertMode) {
                this.uploadDocumentChangesToNeovim();
            }
        });
        this.onChangedEdtiors = () => __awaiter(this, void 0, void 0, function* () {
            yield this.nvimInitPromise;
            let resolvePromise = () => {
                /* ignore */
            };
            this.editorChangedPromise = new Promise(res => {
                resolvePromise = res;
            });
            const requests = [];
            const activeColumns = new Set();
            for (const editor of vscode_1.default.window.visibleTextEditors) {
                const uri = editor.document.uri.toString();
                if (!this.uriToBuffer.has(uri)) {
                    yield this.initBuffer(editor);
                }
                const buf = this.uriToBuffer.get(uri);
                if (!buf) {
                    continue;
                }
                if (!editor.viewColumn) {
                    continue;
                }
                const winId = this.editorColumnIdToWinId.get(editor.viewColumn);
                if (!winId) {
                    continue;
                }
                activeColumns.add(editor.viewColumn);
                // !for external buffer - without set_buf the buffer will disappear when switching to other editor and break vscode editor management
                // ! alternatively we can close the editor with such buf?
                requests.push(["nvim_win_set_buf", [winId, buf.id]]);
                if (this.managedBufferIds.has(buf.id)) {
                    // !important: need to update cursor in atomic operation
                    requests.push(["nvim_win_set_cursor", [winId, this.getNeovimCursorPosForEditor(editor)]]);
                    // !important: need to set cursor to grid_conf because nvim may not send initial grid_cursor_goto
                    const gridConf = [...this.grids].find(([, conf]) => conf.winId === winId);
                    if (gridConf) {
                        gridConf[1].cursorLine = editor.selection.active.line;
                        gridConf[1].cursorPos = editor.selection.active.character;
                    }
                }
                this.applyCursorStyleToEditor(editor, this.currentModeName);
            }
            // iterate through all columns and set non editor buffer in neovim window if there is no active editors exist for this column
            for (const [column, winId] of this.editorColumnIdToWinId) {
                if (activeColumns.has(column)) {
                    continue;
                }
                requests.push(["nvim_win_set_var", [winId, "vscode_clearjump", true]]);
                requests.push(["nvim_win_set_buf", [winId, this.noEditorBuffer.id]]);
            }
            if (activeColumns.has(vscode_1.default.ViewColumn.One)) {
                requests.push(["nvim_call_function", ["VSCodeClearJumpIfFirstWin", []]]);
            }
            yield this.client.callAtomic(requests);
            // wipeout any buffers with non visible documents. We process them here because onDidCloseTextDocument fires before onChangedEditors
            // and wiping out the buffer will close the associated nvim windows normally and we want to prevent this
            const allBuffers = yield this.client.buffers;
            const wipeoutBuffers = new Set();
            for (const buffer of allBuffers) {
                const uri = this.bufferIdToUri.get(buffer.id);
                if (!uri) {
                    continue;
                }
                if (buffer.id === this.noEditorBuffer.id) {
                    continue;
                }
                if (!vscode_1.default.workspace.textDocuments.find(d => d.uri.toString() === uri)) {
                    wipeoutBuffers.add(buffer.id);
                    buffer.unlisten("lines", this.onNeovimBufferEvent);
                    this.bufferIdToUri.delete(buffer.id);
                    this.managedBufferIds.delete(buffer.id);
                    this.uriToBuffer.delete(uri);
                    this.documentChangesInInsertMode.delete(uri);
                    this.documentText.delete(uri);
                    this.documentLastChangedVersion.delete(uri);
                }
            }
            if (wipeoutBuffers.size) {
                yield this.client.command(`bwipeout! ${[...wipeoutBuffers].join(" ")}`);
            }
            resolvePromise();
            this.editorChangedPromise = undefined;
        });
        this.onChangedActiveEditor = (e, init = false) => __awaiter(this, void 0, void 0, function* () {
            // !Note called also when editor changes column
            // !Note. when moving editor to other column, first onChangedActiveEditor is called with existing editor opened
            // !in the destination pane, then onChangedEditors is fired, then onChangedActiveEditor with actual editor
            yield this.nvimInitPromise;
            if (this.editorChangedPromise) {
                yield this.editorChangedPromise;
            }
            if (!e || !e.viewColumn) {
                return;
            }
            const winId = this.editorColumnIdToWinId.get(e.viewColumn);
            if (!winId) {
                return;
            }
            this.applyCursorStyleToEditor(e, this.currentModeName);
            // todo: nvim sometimes doesn't switch current_win when opening vscode with
            // multiple columns and the cursor is in the second+ column. So let's try to call it immediately
            if (init) {
                yield this.client.request("nvim_set_current_win", [winId]);
            }
            const requests = [["nvim_set_current_win", [winId]]];
            const uri = e.document.uri.toString();
            const buf = this.uriToBuffer.get(uri);
            if (buf && this.managedBufferIds.has(buf.id)) {
                requests.unshift(
                // !Note: required otherwise navigating through jump stack may lead to broken state when vscode switches to editor
                // !in the other column but neovim win thinks it has this editor active
                // !Note: not required if editor is forced to opened in the same column
                // ["nvim_win_set_buf", [winId, buf.id]],
                ["nvim_win_set_cursor", [winId, this.getNeovimCursorPosForEditor(e)]]);
                const gridConf = [...this.grids].find(([, conf]) => conf.winId === winId);
                if (gridConf) {
                    gridConf[1].cursorLine = e.selection.active.line;
                    gridConf[1].cursorPos = e.selection.active.character;
                }
            }
            if (init) {
                requests.push(["nvim_call_function", ["VSCodeClearJumpIfFirstWin", []]]);
            }
            if (this.skipJumpsForUris.get(e.document.uri.toString())) {
                this.skipJumpsForUris.delete(e.document.uri.toString());
            }
            else {
                requests.push(["nvim_call_function", ["VSCodeStoreJumpForWin", [winId]]]);
            }
            yield this.client.callAtomic(requests);
        });
        // Following lines are enabling vim-style cursor follow on scroll
        // although it's working, unfortunately it breaks vscode jumplist when scrolling to definition from outline/etc
        // I think it's better ot have more-less usable jumplist than such minor feature at this feature request will be implemented (https://github.com/microsoft/vscode/issues/84351)
        // private onChangeVisibleRange = async (e: vscode.TextEditorVisibleRangesChangeEvent): Promise<void> => {
        //     if (e.textEditor !== vscode.window.activeTextEditor) {
        //         return;
        //     }
        //     const ranges = e.visibleRanges[0];
        //     if (!ranges) {
        //         return;
        //     }
        //     if (this.shouldIgnoreMouseSelection) {
        //         return;
        //     }
        //     const editorRevealLine = this.textEditorsRevealing.get(e.textEditor);
        //     if (editorRevealLine) {
        //         if (editorRevealLine < ranges.start.line || editorRevealLine > ranges.end.line) {
        //             return;
        //         }
        //         this.textEditorsRevealing.delete(e.textEditor);
        //     }
        //     if (!this.isInsertMode) {
        //         this.commitScrolling(e.textEditor);
        //     }
        // };
        // private commitScrolling = throttle(
        //     (e: vscode.TextEditor) => {
        //         if (vscode.window.activeTextEditor !== e) {
        //             return;
        //         }
        //         const cursor = e.selection.active;
        //         const visibleRange = e.visibleRanges[0];
        //         if (!visibleRange) {
        //             return;
        //         }
        //         let updateCursor = false;
        //         if (cursor.line > visibleRange.end.line) {
        //             updateCursor = true;
        //             e.selections = [
        //                 new vscode.Selection(
        //                     visibleRange.end.line,
        //                     cursor.character,
        //                     visibleRange.end.line,
        //                     cursor.character,
        //                 ),
        //             ];
        //         } else if (cursor.line < visibleRange.start.line) {
        //             updateCursor = true;
        //             e.selections = [
        //                 new vscode.Selection(
        //                     visibleRange.start.line,
        //                     cursor.character,
        //                     visibleRange.start.line,
        //                     cursor.character,
        //                 ),
        //             ];
        //         }
        //         if (updateCursor && e.viewColumn) {
        //             const winId = this.editorColumnIdToWinId.get(e.viewColumn);
        //             if (winId) {
        //                 this.updateCursorPositionInNeovim(winId, e.selection.active.line, e.selection.active.character);
        //             }
        //         }
        //     },
        //     500,
        //     { leading: false },
        // );
        // private commitScrollingFast = throttle(this.updateScreenRowFromScrolling, 200, { leading: false });
        /**
         * Handle vscode selection change. This includes everything touching selection or cursor position, includes custom commands and selection = [] assignment
         */
        this.onChangeSelection = (e) => {
            if (e.selections.length === 1 && this.neovimCursorUpdates.has(e.textEditor)) {
                const line = e.selections[0].active.line;
                const col = e.selections[0].active.character;
                const updates = this.neovimCursorUpdates.get(e.textEditor);
                const shouldIgnore = !!updates[`${line}.${col}`];
                delete updates[`${line}.${col}`];
                if (shouldIgnore) {
                    return;
                }
            }
            // try to update cursor in neovim as rarely as we can
            if (this.isInsertMode) {
                return;
            }
            // !Important: ignore selection of non active editor.
            // !For peek definition and similar stuff vscode opens another editor and updates selections here
            // !We must ignore it otherwise the cursor will just "jump"
            // !Note: Seems view column checking is enough
            if (e.textEditor !== vscode_1.default.window.activeTextEditor) {
                return;
            }
            const viewColumn = e.textEditor.viewColumn;
            if (!viewColumn) {
                return;
            }
            if (this.shouldIgnoreMouseSelection) {
                return;
            }
            // must skip unknown kind
            // unfortunately for outline navigation it's also Command change kind, so we mustn't skip it
            // if not it, we can skip whole vscode.TextEditorSelectionChangeKind.Command
            if (!e.kind) {
                return;
            }
            // scroll commands are Keyboard kind
            /*if (e.kind === vscode.TextEditorSelectionChangeKind.Keyboard) {
                return;
            }*/
            const cursor = e.selections[0].active;
            const winId = this.editorColumnIdToWinId.get(viewColumn);
            if (!winId) {
                return;
            }
            const gridConf = [...this.grids].find(g => g[1].winId === winId);
            if (!gridConf) {
                return;
            }
            if (gridConf[1].cursorLine === cursor.line && gridConf[1].cursorPos === cursor.character) {
                return;
            }
            // multi-selection
            if (e.selections.length > 1 || !e.selections[0].active.isEqual(e.selections[0].anchor)) {
                if (e.kind !== vscode_1.default.TextEditorSelectionChangeKind.Mouse || !this.mouseSelectionEnabled) {
                    return;
                }
                else {
                    const requests = [];
                    if (this.currentModeName !== "visual") {
                        // need to start visual mode from anchor char
                        const firstPos = e.selections[0].anchor;
                        const mouseClickPos = this.getNeovimCursorPosForEditor(e.textEditor, firstPos);
                        requests.push([
                            "nvim_input_mouse",
                            // nvim_input_mouse is zero based while getNeovimCursorPosForEditor() returns 1 based line
                            ["left", "press", "", gridConf[0], mouseClickPos[0] - 1, mouseClickPos[1]],
                        ]);
                        requests.push(["nvim_input", ["v"]]);
                    }
                    const lastSelection = e.selections.slice(-1)[0];
                    if (!lastSelection) {
                        return;
                    }
                    requests.push([
                        "nvim_win_set_cursor",
                        [winId, this.getNeovimCursorPosForEditor(e.textEditor, lastSelection.active)],
                    ]);
                    this.client.callAtomic(requests);
                }
            }
            else {
                let createJumpEntry = !e.kind || e.kind === vscode_1.default.TextEditorSelectionChangeKind.Command;
                const skipJump = this.skipJumpsForUris.get(e.textEditor.document.uri.toString());
                if (skipJump) {
                    createJumpEntry = false;
                    this.skipJumpsForUris.delete(e.textEditor.document.uri.toString());
                }
                this.updateCursorPositionInNeovim(winId, this.getNeovimCursorPosForEditor(e.textEditor), createJumpEntry);
            }
            // let shouldUpdateNeovimCursor = false;
            // if (
            //     (cursor.line !== this.nvimRealLinePosition || cursor.character !== this.nvimRealColPosition) &&
            //     !this.isInsertMode
            // ) {
            //     shouldUpdateNeovimCursor = true;
            // }
            // if (shouldUpdateNeovimCursor) {
            //     // when jumping to definition cursor line is new and visible range is old, we'll align neovim screen row after scroll
            //     // const cursorScreenRow = visibleRange.contains(cursor) ? cursor.line - visibleRange.start.line : undefined;
            //     // when navigating to different file the onChangeSelection may come before onChangedTextEditor, so make sure we won't set cursor in the wrong buffer
            //     const uri = e.textEditor.document.uri.toString();
            //     const buf = this.uriToBuffer.get(uri);
            //     if (!buf || buf !== this.currentNeovimBuffer) {
            //         return;
            //     }
            //     this.updateCursorPositionInNeovim(cursor.line, cursor.character);
            // }
            // Kind may be undefined when:
            // 1) opening file
            // 2) setting selection in code
            /*if (!e.kind || e.kind === vscode.TextEditorSelectionChangeKind.Keyboard) {
                return;
            }
            // support mouse visual selection
            if (
                e.kind === vscode.TextEditorSelectionChangeKind.Mouse &&
                (e.selections.length > 1 || !e.selections[0].active.isEqual(e.selections[0].anchor)) &&
                this.mouseSelectionEnabled
            ) {
                const requests: [string, VimValue[]][] = [];
                if (this.currentModeName !== "visual") {
                    requests.push(["nvim_input", ["v"]]);
                }
                const lastSelection = e.selections.slice(-1)[0];
                requests.push([
                    "nvim_win_set_cursor",
                    [0, [lastSelection.active.line + 1, lastSelection.active.character]],
                ]);
                await this.client.callAtomic(requests);
            } else if (!this.isScrolling) {
                // exclude clicks while in scrolling/in scroll commiting. It'll be handled in commitScrolling()
                const screenRow =
                    e.kind === vscode.TextEditorSelectionChangeKind.Mouse
                        ? cursor.line - e.textEditor.visibleRanges[0].start.line - 1
                        : undefined;
                const cusror = e.textEditor.selection.active;
                await this.updateCursorPositionInNeovim(cusror.line, cusror.character, screenRow);
            }*/
        };
        this.onVSCodeType = (_editor, edit, type) => {
            if (!this.isInit) {
                return;
            }
            if (!this.isInsertMode || this.isRecording) {
                this.client.input(this.normalizeKey(type.text));
            }
            else {
                vscode_1.default.commands.executeCommand("default:type", { text: type.text });
            }
        };
        this.onNeovimBufferEvent = (buffer, tick, firstLine, lastLine, linedata, _more) => {
            // ignore in insert mode. This breaks o and O commands with <count> prefix but since we're rebinding them
            // to vscode commands it's not a big problem and anyway not supported (at least for now)
            // if (this.isInsertMode) {
            //     return;
            // }
            // vscode disallow to do multiple edits without awaiting textEditor.edit result
            // so we'll process all changes in slightly throttled function
            this.pendingBufChangesQueue.push({ buffer, firstLine, lastLine, data: linedata, tick });
            if (this.resolveBufQueuePromise) {
                this.resolveBufQueuePromise();
            }
        };
        this.watchAndApplyNeovimEdits = () => __awaiter(this, void 0, void 0, function* () {
            // eslint-disable-next-line no-constant-condition
            while (true) {
                const edits = this.pendingBufChangesQueue.splice(0);
                if (!edits.length) {
                    let timeout;
                    this.bufQueuePromise = new Promise(res => {
                        this.resolveBufQueuePromise = res;
                        // not necessary to timeout at all, but let's make sure
                        // !note looks like needed - increasing value starting to produce buffer desync. Because of this?
                        timeout = setTimeout(res, 40);
                    });
                    yield this.bufQueuePromise;
                    if (timeout) {
                        clearTimeout(timeout);
                    }
                    this.bufQueuePromise = undefined;
                    this.resolveBufQueuePromise = undefined;
                }
                else {
                    const changes = new Map();
                    for (const { buffer, data, firstLine, lastLine, tick } of edits) {
                        const uri = this.bufferIdToUri.get(buffer.id);
                        if (!uri) {
                            continue;
                        }
                        let textEditor;
                        if (this.externalBuffersShowOnNextChange.has(buffer.id)) {
                            this.externalBuffersShowOnNextChange.delete(buffer.id);
                            textEditor = yield vscode_1.default.window.showTextDocument(vscode_1.default.Uri.parse(uri));
                        }
                        else {
                            textEditor = vscode_1.default.window.visibleTextEditors.find(e => e.document.uri.toString() === uri);
                        }
                        if (!textEditor) {
                            continue;
                        }
                        let change = changes.get(uri);
                        if (!change) {
                            const eol = textEditor.document.eol === vscode_1.default.EndOfLine.CRLF ? "\r\n" : "\n";
                            change = {
                                lines: textEditor.document.getText().split(eol),
                                editor: textEditor,
                                changed: false,
                            };
                            changes.set(uri, change);
                        }
                        const skipTick = this.skipBufferTickUpdate.get(buffer.id) || 0;
                        if (skipTick >= tick) {
                            continue;
                        }
                        // happens after undo
                        if (firstLine === lastLine && data.length === 0) {
                            continue;
                        }
                        change.changed = true;
                        // nvim sends following:
                        // 1. string change - firstLine is the changed line , lastLine + 1
                        // 2. cleaned line but not deleted - first line is the changed line, lastLine + 1, linedata is ""
                        // 3. newline insert - firstLine = lastLine and linedata is "" or new data
                        // 4. line deleted - firstLine is changed line, lastLine + 1, linedata is empty []
                        // LAST LINE is exclusive and can be out of the last editor line
                        if (firstLine !== lastLine && data.length === 1 && data[0] === "") {
                            // 2
                            for (let line = firstLine; line < lastLine; line++) {
                                change.lines[line] = "";
                            }
                        }
                        else if (firstLine !== lastLine && !data.length) {
                            // 4
                            for (let line = 0; line < lastLine - firstLine; line++) {
                                change.lines.splice(firstLine, 1);
                            }
                        }
                        else if (firstLine === lastLine) {
                            // 3
                            if (firstLine > change.lines.length) {
                                data.unshift("");
                            }
                            if (firstLine === 0) {
                                change.lines.unshift(...data);
                            }
                            else {
                                change.lines = [
                                    ...change.lines.slice(0, firstLine),
                                    ...data,
                                    ...change.lines.slice(firstLine),
                                ];
                            }
                        }
                        else {
                            // 1 or 3
                            // handle when change is overflow through editor lines. E.g. pasting on last line.
                            // Without newline it will append to the current one
                            if (firstLine >= change.lines.length) {
                                data.unshift("");
                            }
                            change.lines = [...change.lines.slice(0, firstLine), ...data, ...change.lines.slice(lastLine)];
                            // for (let i = 0; i < data.length; i++) {
                            //     const str = data[i];
                            //     const line = firstLine + i;
                            //     if (line >= lastLine) {
                            //         change.lines = [...change.lines.slice(0, line), str, ...change.lines.slice(line + 1)];
                            //     } else if (typeof change.lines[line] === "undefined") {
                            //         change.lines.push(str);
                            //     } else {
                            //         change.lines[line] = str;
                            //     }
                            // }
                            // if (firstLine + data.length < lastLine) {
                            //     const reduceFrom = firstLine + data.length;
                            //     for (let line = firstLine + data.length; line < lastLine; line++) {
                            //         change.lines.splice(reduceFrom, 1);
                            //     }
                            // }
                        }
                    }
                    // replacing lines with WorkspaceEdit() moves cursor to the end of the line, unfortunately this won't work
                    // const workspaceEdit = new vscode.WorkspaceEdit();
                    try {
                        for (const [uri, change] of changes) {
                            const { editor, lines, changed } = change;
                            if (!changed) {
                                continue;
                            }
                            let oldText = editor.document.getText();
                            const eol = editor.document.eol === vscode_1.default.EndOfLine.CRLF ? "\r\n" : "\n";
                            let newText = lines.join(eol);
                            // add few lines to the end otherwise diff may be wrong for a newline characters
                            oldText += `${eol}end${eol}end`;
                            newText += `${eol}end${eol}end`;
                            const diffPrepare = Utils.diffLineToChars(oldText, newText);
                            const d = fast_diff_1.default(diffPrepare.chars1, diffPrepare.chars2);
                            const ranges = Utils.prepareEditRangesFromDiff(d);
                            if (!ranges.length) {
                                continue;
                            }
                            this.documentLastChangedVersion.set(uri, editor.document.version + 1);
                            // const cursor = editor.selection.active;
                            const success = yield editor.edit(builder => {
                                for (const range of ranges) {
                                    const text = lines.slice(range.newStart, range.newEnd + 1);
                                    if (range.type === "removed") {
                                        if (range.end >= editor.document.lineCount - 1 && range.start > 0) {
                                            const startChar = editor.document.lineAt(range.start - 1).range.end.character;
                                            builder.delete(new vscode_1.default.Range(range.start - 1, startChar, range.end, 999999));
                                        }
                                        else {
                                            builder.delete(new vscode_1.default.Range(range.start, 0, range.end + 1, 0));
                                        }
                                    }
                                    else if (range.type === "changed") {
                                        builder.replace(new vscode_1.default.Range(range.start, 0, range.end, 999999), text.join("\n"));
                                    }
                                    else if (range.type === "added") {
                                        if (range.start >= editor.document.lineCount) {
                                            text.unshift(...new Array(range.start - (editor.document.lineCount - 1)).fill(""));
                                        }
                                        else {
                                            text.push("");
                                        }
                                        builder.replace(new vscode_1.default.Position(range.start, 0), text.join("\n"));
                                    }
                                }
                            });
                            if (success) {
                                // workaround for cursor moving after inserting some text
                                // it's not the ideal solution since there is minor transition from selection to single cursor
                                // todo: another solution is to combine ranges and replacing text starting by prev line when need to insert something
                                // if (!editor.selection.anchor.isEqual(editor.selection.active)) {
                                //     // workaround cursor in insert recording mode
                                //     // todo: why it's needed???
                                //     if (this.isRecording) {
                                //         editor.selections = [
                                //             new vscode.Selection(editor.selection.active, editor.selection.active),
                                //         ];
                                //     } else {
                                //         editor.selections = [new vscode.Selection(cursor, cursor)];
                                //     }
                                // }
                                if (!this.isInsertMode) {
                                    // vscode manages cursor after edits very differently so
                                    // try to set cursor pos for the one obtained from neovim. This may be wrong because of race conditions
                                    if (editor.viewColumn) {
                                        const winId = this.editorColumnIdToWinId.get(editor.viewColumn);
                                        if (winId) {
                                            const gridConf = [...this.grids].find(([, conf]) => conf.winId === winId);
                                            if (gridConf) {
                                                const cursorPos = Utils.getEditorCursorPos(editor, gridConf[1]);
                                                this.updateCursorPosInEditor(editor, cursorPos.line, cursorPos.col);
                                                // editor.selections = [
                                                //     new vscode.Selection(
                                                //         cursorPos.line,
                                                //         cursorPos.col,
                                                //         cursorPos.line,
                                                //         cursorPos.col,
                                                //     ),
                                                // ];
                                            }
                                        }
                                    }
                                }
                                else if (this.isRecording) {
                                    editor.selections = [
                                        new vscode_1.default.Selection(editor.selection.active, editor.selection.active),
                                    ];
                                }
                                this.documentText.set(uri, editor.document.getText());
                            }
                        }
                        // if (workspaceEdit.size) {
                        //     await vscode.workspace.applyEdit(workspaceEdit);
                        // }
                    }
                    catch (e) {
                        yield vscode_1.default.window.showErrorMessage("vscode-neovim: Error applying neovim edits, please report a bug, error: " + e.message);
                    }
                }
            }
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.onNeovimNotification = (method, events) => {
            if (method === "vscode-command") {
                const [vscodeCommand, commandArgs] = events;
                this.handleVSCodeCommand(vscodeCommand, Array.isArray(commandArgs) ? commandArgs : [commandArgs]);
                return;
            }
            if (method === "vscode-range-command") {
                const [vscodeCommand, line1, line2, pos1, pos2, leaveSelection, args] = events;
                this.handleVSCodeRangeCommand(vscodeCommand, line1, line2, pos1, pos2, !!leaveSelection, Array.isArray(args) ? args : [args]);
                return;
            }
            if (method === "vscode-neovim") {
                const [command, args] = events;
                this.handleExtensionRequest(command, args);
                return;
            }
            if (method !== "redraw") {
                return;
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const currRedrawNotifications = [];
            let flush = false;
            for (const [name, ...args] of events) {
                if (name === "flush") {
                    flush = true;
                }
                else {
                    currRedrawNotifications.push([name, ...args]);
                }
            }
            if (flush) {
                const batch = [...this.currentRedrawBatch.splice(0), ...currRedrawNotifications];
                this.processRedrawBatch(batch);
            }
            else {
                this.currentRedrawBatch.push(...currRedrawNotifications);
            }
        };
        this.processRedrawBatch = (batch) => {
            let newModeName;
            // since neovim sets cmdheight=0 internally various vim plugins like easymotion are working incorrect and awaiting hitting enter
            let acceptPrompt = false;
            const gridCursorUpdates = new Set();
            const gridHLUpdates = new Set();
            // must to setup win conf event first
            const winEvents = batch.filter(([name]) => name === "win_pos" || name === "win_external_pos");
            if (winEvents.length) {
                batch.unshift(...winEvents);
            }
            for (const [name, ...args] of batch) {
                const firstArg = args[0] || [];
                switch (name) {
                    case "mode_info_set": {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const [, modes] = firstArg;
                        for (const mode of modes) {
                            if (!mode.name) {
                                continue;
                            }
                            this.vimModes.set(mode.name, "cursor_shape" in mode
                                ? {
                                    attrId: mode.attr_id,
                                    attrIdLm: mode.attr_id_lm,
                                    cursorShape: mode.cursor_shape,
                                    name: mode.name,
                                    shortName: mode.short_name,
                                    blinkOff: mode.blinkoff,
                                    blinkOn: mode.blinkon,
                                    blinkWait: mode.blinkwait,
                                    cellPercentage: mode.cell_percentage,
                                    mouseShape: mode.mouse_shape,
                                }
                                : {
                                    name: mode.name,
                                    shortName: mode.short_name,
                                    mouseShape: mode.mouse_shape,
                                });
                        }
                        break;
                    }
                    case "hl_attr_define": {
                        // eslint-disable-next-line @typescript-eslint/no-unused-vars
                        for (const [id, uiAttrs, , info] of args) {
                            if (info && info[0] && info[0].hi_name) {
                                const name = info[0].hi_name;
                                this.highlightProvider.addHighlightGroup(id, name, uiAttrs);
                                if (name === "LineNr") {
                                    this.numberLineHlId = id;
                                }
                            }
                        }
                        break;
                    }
                    case "cmdline_show": {
                        // eslint-disable-next-line @typescript-eslint/no-unused-vars
                        const [content, pos, firstc, prompt, indent, level] = firstArg;
                        const allContent = content.map(([, str]) => str).join("");
                        // !note: neovim can send cmdline_hide followed by cmdline_show events
                        // !since quickpick can be destroyed slightly at later time after handling cmdline_hide we want to create new command line
                        // !controller and input for every visible cmdline_show event
                        // !otherwise we may hit cmdline_show when it's being hidden
                        // as alternative, it's possible to process batch and determine if we need show/hide or just redraw the command_line
                        // but this won't handle the case when cmdline_show comes in next flush batch (is it possible?)
                        // btw, easier to just recreate whole command line (and quickpick inside)
                        if (this.cmdlineTimer) {
                            clearTimeout(this.cmdlineTimer);
                            this.cmdlineTimer = undefined;
                            if (!this.commandLine) {
                                this.commandLine = new command_line_1.CommandLineController(this.client, {
                                    onAccepted: this.onCmdAccept,
                                    onCanceled: this.onCmdCancel,
                                    onChanged: this.onCmdChange,
                                });
                            }
                            this.commandLine.show(allContent, firstc, prompt);
                        }
                        else {
                            // if there is initial content and it's not currently displayed then it may come
                            // from some mapping. to prevent bad UI commandline transition we delay cmdline appearing here
                            if (allContent !== "" && allContent !== "'<,'>" && !this.commandLine) {
                                this.cmdlineTimer = setTimeout(() => this.showCmdOnTimer(allContent, firstc, prompt), 200);
                            }
                            else {
                                if (!this.commandLine) {
                                    this.commandLine = new command_line_1.CommandLineController(this.client, {
                                        onAccepted: this.onCmdAccept,
                                        onCanceled: this.onCmdCancel,
                                        onChanged: this.onCmdChange,
                                    });
                                }
                                this.commandLine.show(allContent, firstc, prompt);
                            }
                        }
                        break;
                    }
                    case "wildmenu_show": {
                        const [items] = firstArg;
                        if (this.commandLine) {
                            this.commandLine.setCompletionItems(items);
                        }
                        break;
                    }
                    case "cmdline_hide": {
                        if (this.cmdlineTimer) {
                            clearTimeout(this.cmdlineTimer);
                            this.cmdlineTimer = undefined;
                        }
                        else if (this.commandLine) {
                            this.commandLine.cancel(true);
                            this.commandLine.dispose();
                            this.commandLine = undefined;
                        }
                        break;
                    }
                    case "msg_showcmd": {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const [content] = firstArg;
                        let str = "";
                        if (content) {
                            for (const c of content) {
                                const [, cmdStr] = c;
                                if (cmdStr) {
                                    str += cmdStr;
                                }
                            }
                        }
                        this.statusLine.statusString = str;
                        break;
                    }
                    case "msg_show": {
                        let str = "";
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        for (const [type, content] of args) {
                            // if (ui === "confirm" || ui === "confirmsub" || ui === "return_prompt") {
                            //     this.nextInputBlocking = true;
                            // }
                            if (type === "return_prompt") {
                                acceptPrompt = true;
                            }
                            if (content) {
                                for (const c of content) {
                                    const [, cmdStr] = c;
                                    if (cmdStr) {
                                        str += cmdStr;
                                    }
                                }
                            }
                        }
                        this.statusLine.msgString = str;
                        break;
                    }
                    case "msg_showmode": {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const [content] = firstArg;
                        let str = "";
                        if (content) {
                            for (const c of content) {
                                const [, modeStr] = c;
                                if (modeStr) {
                                    str += modeStr;
                                }
                            }
                        }
                        this.statusLine.modeString = str;
                        break;
                    }
                    case "msg_clear": {
                        this.statusLine.msgString = "";
                        break;
                    }
                    case "mode_change": {
                        [newModeName] = firstArg;
                        break;
                    }
                    case "win_pos": {
                        const [grid, win] = firstArg;
                        if (!this.grids.has(grid)) {
                            this.grids.set(grid, {
                                winId: win.id,
                                cursorLine: 0,
                                cursorPos: 0,
                                screenPos: 0,
                                screenLine: 0,
                                topScreenLineStr: "      1 ",
                                bottomScreenLineStr: "    201 ",
                            });
                        }
                        else {
                            const conf = this.grids.get(grid);
                            if (!conf.winId) {
                                conf.winId = win.id;
                            }
                        }
                        break;
                    }
                    case "win_close": {
                        for (const [grid] of args) {
                            this.grids.delete(grid);
                        }
                        break;
                    }
                    case "win_external_pos": {
                        for (const [grid, win] of args) {
                            if (!this.grids.has(grid)) {
                                this.grids.set(grid, {
                                    winId: win.id,
                                    cursorLine: 0,
                                    cursorPos: 0,
                                    screenPos: 0,
                                    screenLine: 0,
                                    topScreenLineStr: "      1 ",
                                    bottomScreenLineStr: "    201 ",
                                });
                            }
                            else {
                                const conf = this.grids.get(grid);
                                if (!conf.winId) {
                                    conf.winId = win.id;
                                }
                            }
                        }
                        break;
                    }
                    // nvim may not send grid_cursor_goto and instead uses grid_scroll along with grid_line
                    case "grid_scroll": {
                        for (const [grid, , , , , by] of args) {
                            if (grid === 1) {
                                continue;
                            }
                            gridCursorUpdates.add(grid);
                            // by > 0 - scroll down, must remove existing elements from first and shift row hl left
                            // by < 0 - scroll up, must remove existing elements from right shift row hl right
                            this.highlightProvider.shiftGridHighlights(grid, by);
                        }
                        break;
                    }
                    case "grid_cursor_goto": {
                        for (const [grid, screenRow, screenCol] of args) {
                            const conf = this.grids.get(grid);
                            const normalizedScreenCol = screenCol - NUMBER_COLUMN_WIDTH;
                            if (conf) {
                                conf.screenLine = screenRow;
                                conf.screenPos = normalizedScreenCol;
                                gridCursorUpdates.add(grid);
                            }
                        }
                        break;
                    }
                    case "grid_line": {
                        // [grid, row, colStart, cells: [text, hlId, repeat]]
                        const gridEvents = args;
                        // align topScreenLine if needed. we need to look for both FIRST_SCREEN_LINE and LAST_SCREEN_LINE because nvim may replace lines only at bottom/top
                        const firstLinesEvents = gridEvents.filter(([, line, , cells]) => line === FIRST_SCREEN_LINE && cells[0] && cells[0][1] === this.numberLineHlId);
                        const lastLinesEvents = gridEvents.filter(([, line, , cells]) => line === LAST_SCREEN_LINE && cells[0] && cells[0][1] === this.numberLineHlId);
                        for (const evt of firstLinesEvents) {
                            const [grid] = evt;
                            let gridConf = this.grids.get(grid);
                            if (!gridConf) {
                                gridConf = {
                                    cursorLine: 0,
                                    cursorPos: 0,
                                    screenPos: 0,
                                    screenLine: 0,
                                    topScreenLineStr: "      1 ",
                                    bottomScreenLineStr: "    201 ",
                                    winId: 0,
                                };
                                this.grids.set(grid, gridConf);
                            }
                            const topLineStr = Utils.processLineNumberStringFromEvent(evt, this.numberLineHlId, gridConf.topScreenLineStr);
                            const topLine = Utils.getLineFromLineNumberString(topLineStr);
                            const bottomLine = topLine + LAST_SCREEN_LINE;
                            const bottomLineStr = Utils.convertLineNumberToString(bottomLine + 1);
                            gridConf.topScreenLineStr = topLineStr;
                            gridConf.bottomScreenLineStr = bottomLineStr;
                            // !important don't put cursor update
                            // gridCursorUpdates.add(grid);
                        }
                        for (const evt of lastLinesEvents) {
                            const [grid] = evt;
                            let gridConf = this.grids.get(grid);
                            if (!gridConf) {
                                gridConf = {
                                    cursorLine: 0,
                                    cursorPos: 0,
                                    screenPos: 0,
                                    screenLine: 0,
                                    topScreenLineStr: "      1 ",
                                    bottomScreenLineStr: "    201 ",
                                    winId: 0,
                                };
                                this.grids.set(grid, gridConf);
                            }
                            const bottomLineStr = Utils.processLineNumberStringFromEvent(evt, this.numberLineHlId, gridConf.bottomScreenLineStr);
                            const bottomLine = Utils.getLineFromLineNumberString(bottomLineStr);
                            const topLine = bottomLine - LAST_SCREEN_LINE;
                            //
                            const topLineStr = Utils.convertLineNumberToString(topLine + 1);
                            gridConf.bottomScreenLineStr = bottomLineStr;
                            gridConf.topScreenLineStr = topLineStr;
                            // gridCursorUpdates.add(grid);
                        }
                        // eslint-disable-next-line prefer-const
                        for (let [grid, row, colStart, cells] of gridEvents) {
                            if (row > LAST_SCREEN_LINE) {
                                continue;
                            }
                            const gridConf = this.grids.get(grid);
                            if (!gridConf) {
                                continue;
                            }
                            const columnToWinId = [...this.editorColumnIdToWinId].find(([, id]) => id === gridConf.winId);
                            if (!columnToWinId) {
                                continue;
                            }
                            const editor = vscode_1.default.window.visibleTextEditors.find(e => e.viewColumn === columnToWinId[0]);
                            if (!editor) {
                                continue;
                            }
                            // const topScreenLine = gridConf.cursorLine === 0 ? 0 : gridConf.cursorLine - gridConf.screenLine;
                            const topScreenLine = Utils.getLineFromLineNumberString(gridConf.topScreenLineStr);
                            const highlightLine = topScreenLine + row;
                            if (highlightLine >= editor.document.lineCount || highlightLine < 0) {
                                if (highlightLine > 0) {
                                    this.highlightProvider.cleanRow(grid, row);
                                }
                                continue;
                            }
                            const uri = editor.document.uri.toString();
                            const buf = this.uriToBuffer.get(uri);
                            const isExternal = buf && this.managedBufferIds.has(buf.id) ? false : true;
                            let finalStartCol = 0;
                            if (cells[0] && cells[0][1] === this.numberLineHlId) {
                                // remove linenumber cells
                                const firstTextIdx = cells.findIndex(c => c[1] != null && c[1] !== this.numberLineHlId);
                                if (firstTextIdx === -1) {
                                    continue;
                                }
                                cells = cells.slice(firstTextIdx);
                            }
                            else if (colStart === NUMBER_COLUMN_WIDTH) {
                                finalStartCol = 0;
                            }
                            else {
                                const line = editor.document.lineAt(highlightLine).text;
                                // shift left start col (in vim linenumber is accounted, while in vscode don't)
                                // finalStartCol = Utils.getStartColForHL(line, colStart - NUMBER_COLUMN_WIDTH);
                                finalStartCol = Utils.calculateEditorColFromVimScreenCol(line, colStart - NUMBER_COLUMN_WIDTH);
                            }
                            this.highlightProvider.processHLCellsEvent(grid, row, finalStartCol, isExternal, cells);
                            gridHLUpdates.add(grid);
                        }
                        break;
                    }
                }
            }
            this.applyRedrawUpdate(newModeName, gridCursorUpdates, gridHLUpdates, acceptPrompt);
        };
        this.applyRedrawUpdate = (newModeName, cursorUpdates, hlUpdates, acceptPrompt) => {
            if (newModeName) {
                this.handleModeChange(newModeName);
            }
            for (const grid of cursorUpdates) {
                const gridConf = this.grids.get(grid);
                if (!gridConf) {
                    continue;
                }
                const columnConf = [...this.editorColumnIdToWinId].find(([, winId]) => winId === gridConf.winId);
                if (!columnConf) {
                    continue;
                }
                const editor = vscode_1.default.window.visibleTextEditors.find(e => e.viewColumn === columnConf[0]);
                if (!editor) {
                    continue;
                }
                if (editor === vscode_1.default.window.activeTextEditor && this.ignoreNextCursorUpdate) {
                    this.ignoreNextCursorUpdate = false;
                    continue;
                }
                const cursor = Utils.getEditorCursorPos(editor, gridConf);
                const currentCursor = editor.selection.active;
                if (currentCursor.line === cursor.line && currentCursor.character === cursor.col) {
                    continue;
                }
                gridConf.cursorLine = cursor.line;
                gridConf.cursorPos = cursor.col;
                // allow to update cursor only for active editor
                if (editor === vscode_1.default.window.activeTextEditor) {
                    this.updateCursorPosInEditor(editor, cursor.line, cursor.col);
                }
            }
            for (const grid of hlUpdates) {
                const gridConf = this.grids.get(grid);
                if (!gridConf) {
                    continue;
                }
                const columnToWinId = [...this.editorColumnIdToWinId].find(([, id]) => id === gridConf.winId);
                if (!columnToWinId) {
                    continue;
                }
                const editor = vscode_1.default.window.visibleTextEditors.find(e => e.viewColumn === columnToWinId[0]);
                if (!editor) {
                    continue;
                }
                const hls = this.highlightProvider.getGridHighlights(grid, Utils.getLineFromLineNumberString(gridConf.topScreenLineStr));
                for (const [decorator, ranges] of hls) {
                    editor.setDecorations(decorator, ranges);
                }
            }
            if (acceptPrompt) {
                this.client.input("<CR>");
            }
        };
        this.handleModeChange = (modeName) => {
            this.isInsertMode = modeName === "insert";
            if (this.isInsertMode && this.typeHandlerDisplose && !this.isRecording) {
                this.typeHandlerDisplose.dispose();
                this.typeHandlerDisplose = undefined;
            }
            else if (!this.isInsertMode && !this.typeHandlerDisplose) {
                this.typeHandlerDisplose = vscode_1.default.commands.registerTextEditorCommand("type", this.onVSCodeType);
            }
            if (this.isRecording) {
                if (modeName === "insert") {
                    vscode_1.default.commands.executeCommand("setContext", "neovim.recording", true);
                }
                else {
                    this.isRecording = false;
                    vscode_1.default.commands.executeCommand("setContext", "neovim.recording", false);
                }
            }
            this.currentModeName = modeName;
            const e = vscode_1.default.window.activeTextEditor;
            if (!e) {
                return;
            }
            vscode_1.default.commands.executeCommand("setContext", "neovim.mode", modeName);
            this.applyCursorStyleToEditor(e, modeName);
        };
        this.getNeovimCursorPosForEditor = (e, pos) => {
            const cursor = pos || e.selection.active;
            const lineText = e.document.lineAt(cursor.line).text;
            const byteCol = Utils.convertCharNumToByteNum(lineText, cursor.character);
            return [cursor.line + 1, byteCol];
        };
        this.updateCursorPositionInNeovim = (winId, cursor, createJumpEntry = false) => __awaiter(this, void 0, void 0, function* () {
            const requests = [["nvim_win_set_cursor", [winId, cursor]]];
            if (createJumpEntry) {
                requests.push(["nvim_call_function", ["VSCodeStoreJumpForWin", [winId]]]);
            }
            yield this.client.callAtomic(requests);
        });
        /**
         * Update cursor in active editor. Coords are zero based
         */
        this.updateCursorPosInEditor = (editor, newLine, newCol) => {
            if (this.leaveMultipleCursorsForVisualMode) {
                return;
            }
            const visibleRange = editor.visibleRanges[0];
            const revealCursor = new vscode_1.default.Selection(newLine, newCol, newLine, newCol);
            if (!this.neovimCursorUpdates.has(editor)) {
                this.neovimCursorUpdates.set(editor, {});
            }
            this.neovimCursorUpdates.get(editor)[`${newLine}.${newCol}`] = true;
            editor.selections = [revealCursor];
            const visibleLines = visibleRange.end.line - visibleRange.start.line;
            // this.commitScrolling.cancel();
            if (visibleRange.contains(revealCursor)) {
                // always try to reveal even if in visible range to reveal horizontal scroll
                editor.revealRange(new vscode_1.default.Range(revealCursor.active, revealCursor.active), vscode_1.default.TextEditorRevealType.Default);
            }
            else if (revealCursor.active.line < visibleRange.start.line) {
                const revealType = visibleRange.start.line - revealCursor.active.line >= visibleLines / 2
                    ? vscode_1.default.TextEditorRevealType.Default
                    : vscode_1.default.TextEditorRevealType.AtTop;
                // this.textEditorsRevealing.set(editor, revealCursor.active.line);
                editor.revealRange(new vscode_1.default.Range(revealCursor.active, revealCursor.active), revealType);
                // vscode.commands.executeCommand("revealLine", { lineNumber: revealCursor.active.line, at: revealType });
            }
            else if (revealCursor.active.line > visibleRange.end.line) {
                const revealType = revealCursor.active.line - visibleRange.end.line >= visibleLines / 2
                    ? vscode_1.default.TextEditorRevealType.InCenter
                    : vscode_1.default.TextEditorRevealType.Default;
                // this.textEditorsRevealing.set(editor, revealCursor.active.line);
                editor.revealRange(new vscode_1.default.Range(revealCursor.active, revealCursor.active), revealType);
                // vscode.commands.executeCommand("revealLine", { lineNumber: revealCursor.active.line, at: revealType });
            }
        };
        this.handleCustomRequest = (eventName, eventArgs, response) => __awaiter(this, void 0, void 0, function* () {
            try {
                let result;
                if (eventName === "vscode-command") {
                    const [vscodeCommand, commandArgs] = eventArgs;
                    result = yield this.handleVSCodeCommand(vscodeCommand, Array.isArray(commandArgs) ? commandArgs : [commandArgs]);
                }
                else if (eventName === "vscode-range-command") {
                    const [vscodeCommand, line1, line2, pos1, pos2, leaveSelection, commandArgs] = eventArgs;
                    result = yield this.handleVSCodeRangeCommand(vscodeCommand, line1, line2, pos1, pos2, !!leaveSelection, Array.isArray(commandArgs) ? commandArgs : [commandArgs]);
                }
                else if (eventName === "vscode-neovim") {
                    const [command, commandArgs] = eventArgs;
                    result = yield this.handleExtensionRequest(command, commandArgs);
                }
                response.send(result || "", false);
            }
            catch (e) {
                response.send(e.message, true);
            }
        });
        this.runVSCodeCommand = (commandName, ...args) => __awaiter(this, void 0, void 0, function* () {
            const res = yield vscode_1.default.commands.executeCommand(commandName, ...args);
            return res;
        });
        this.uploadDocumentChangesToNeovim = () => __awaiter(this, void 0, void 0, function* () {
            const requests = [];
            for (const [uri, changed] of this.documentChangesInInsertMode) {
                if (!changed) {
                    continue;
                }
                this.documentChangesInInsertMode.set(uri, false);
                let origText = this.documentText.get(uri);
                if (origText == null) {
                    continue;
                }
                const document = vscode_1.default.workspace.textDocuments.find(d => d.uri.toString() === uri);
                if (!document) {
                    continue;
                }
                const eol = document.eol === vscode_1.default.EndOfLine.LF ? "\n" : "\r\n";
                const buf = this.uriToBuffer.get(uri);
                if (!buf) {
                    continue;
                }
                let newText = document.getText();
                this.documentText.set(uri, newText);
                // workaround about problem changing last line when it's empty
                // todo: it doesn't work if you just add empty line without changing it
                // if (origText.slice(-1) === "\n" || origText.slice(-1) === "\r\n") {
                // add few lines to the end otherwise diff may be wrong for a newline characters
                origText += `${eol}end${eol}end`;
                newText += `${eol}end${eol}end`;
                // }
                const diffPrepare = Utils.diffLineToChars(origText, newText);
                const d = fast_diff_1.default(diffPrepare.chars1, diffPrepare.chars2);
                const ranges = Utils.prepareEditRangesFromDiff(d);
                if (!ranges.length) {
                    continue;
                }
                // dmp.diff_charsToLines_(diff, diffPrepare.lineArray);
                const bufLinesRequests = [];
                // each subsequent nvim_buf_set_lines uses the result of previous nvim_buf_set_lines so we must shift start/end
                let lineDiffForNextChange = 0;
                for (const range of ranges) {
                    let text = document.getText(new vscode_1.default.Range(range.newStart, 0, range.newEnd, 999999)).split(eol);
                    const start = range.start + lineDiffForNextChange;
                    let end = range.end + lineDiffForNextChange;
                    if (range.type === "removed") {
                        text = [];
                        end++;
                        lineDiffForNextChange--;
                    }
                    else if (range.type === "changed") {
                        // workaround for the diff issue when you put newline after the first line
                        // diff doesn't account this case
                        if ((newText.slice(-1) === "\n" || newText.slice(-1) === "\r\n") && !origText.includes(eol)) {
                            text.push("");
                        }
                        end++;
                    }
                    else if (range.type === "added") {
                        // prevent adding newline
                        if (range.start === 0 && !origText) {
                            end++;
                        }
                        lineDiffForNextChange++;
                        // if (text.slice(-1)[0] === "") {
                        //     text.pop();
                        // }
                        // text.push("\n");
                    }
                    bufLinesRequests.push(["nvim_buf_set_lines", [buf.id, start, end, false, text]]);
                    lineDiffForNextChange += range.newEnd - range.newStart - (range.end - range.start);
                }
                const bufTick = yield buf.changedtick;
                // const bufTick = this.skipBufferTickUpdate.get(buf.id) || 0;
                this.skipBufferTickUpdate.set(buf.id, bufTick + bufLinesRequests.length);
                requests.push(...bufLinesRequests);
            }
            if (vscode_1.default.window.activeTextEditor) {
                requests.push([
                    "nvim_win_set_cursor",
                    [0, this.getNeovimCursorPosForEditor(vscode_1.default.window.activeTextEditor)],
                ]);
            }
            if (!requests.length) {
                return;
            }
            yield this.client.callAtomic(requests);
        });
        this.onEscapeKeyCommand = () => __awaiter(this, void 0, void 0, function* () {
            if (!this.isInit) {
                return;
            }
            if (this.isInsertMode) {
                this.leaveMultipleCursorsForVisualMode = false;
                yield this.uploadDocumentChangesToNeovim();
            }
            yield this.client.input("<Esc>");
            // const buf = await this.client.buffer;
            // const lines = await buf.lines;
            // console.log("====LINES====");
            // console.log(lines.length);
            // console.log(lines.join("\n"));
            // console.log("====END====");
        });
        this.showCmdOnTimer = (initialContent, firstc, prompt) => {
            if (!this.commandLine) {
                this.commandLine = new command_line_1.CommandLineController(this.client, {
                    onAccepted: this.onCmdAccept,
                    onCanceled: this.onCmdCancel,
                    onChanged: this.onCmdChange,
                });
            }
            this.commandLine.show(initialContent, firstc, prompt);
            this.cmdlineTimer = undefined;
        };
        this.onCmdChange = (e, complete) => __awaiter(this, void 0, void 0, function* () {
            let keys = "<C-u>" + this.normalizeString(e);
            if (complete) {
                keys += "<Tab>";
            }
            yield this.client.input(keys);
        });
        this.onCmdCancel = () => __awaiter(this, void 0, void 0, function* () {
            yield this.client.input("<Esc>");
        });
        this.onCmdAccept = () => {
            this.client.input("<CR>");
        };
        /// SCROLL COMMANDS ///
        this.scrollPage = (by, to) => {
            vscode_1.default.commands.executeCommand("editorScroll", { to, by, revealCursor: true });
        };
        this.scrollLine = (to) => {
            vscode_1.default.commands.executeCommand("editorScroll", { to, by: "line", revealCursor: false });
        };
        this.goToLine = (to) => {
            const e = vscode_1.default.window.activeTextEditor;
            if (!e) {
                return;
            }
            const topVisible = e.visibleRanges[0].start.line;
            const bottomVisible = e.visibleRanges[0].end.line;
            const lineNum = to === "top"
                ? topVisible
                : to === "bottom"
                    ? bottomVisible
                    : Math.floor(topVisible + (bottomVisible - topVisible) / 2);
            const line = e.document.lineAt(lineNum);
            e.selections = [
                new vscode_1.default.Selection(lineNum, line.firstNonWhitespaceCharacterIndex, lineNum, line.firstNonWhitespaceCharacterIndex),
            ];
        };
        // zz, zt, zb and others
        this.revealLine = (at, resetCursor = false) => {
            const e = vscode_1.default.window.activeTextEditor;
            if (!e) {
                return;
            }
            const cursor = e.selection.active;
            vscode_1.default.commands.executeCommand("revealLine", { lineNumber: cursor.line, at });
            // z<CR>/z./z-
            if (resetCursor) {
                const line = e.document.lineAt(cursor.line);
                e.selections = [
                    new vscode_1.default.Selection(cursor.line, line.firstNonWhitespaceCharacterIndex, cursor.line, line.firstNonWhitespaceCharacterIndex),
                ];
            }
        };
        this.handleCompositeEscapeFirstKey = (key) => __awaiter(this, void 0, void 0, function* () {
            if (this.currentModeName !== "insert") {
                return;
            }
            const now = new Date().getTime();
            if (this.compositeEscapeFirstPressTimestamp && now - this.compositeEscapeFirstPressTimestamp <= 200) {
                // jj
                this.compositeEscapeFirstPressTimestamp = undefined;
                yield vscode_1.default.commands.executeCommand("deleteLeft");
                this.onEscapeKeyCommand();
            }
            else {
                this.compositeEscapeFirstPressTimestamp = now;
                // insert character
                yield vscode_1.default.commands.executeCommand("default:type", { text: key });
            }
        });
        this.handleCompositeEscapeSecondKey = (key) => __awaiter(this, void 0, void 0, function* () {
            if (this.currentModeName !== "insert") {
                return;
            }
            const now = new Date().getTime();
            if (this.compositeEscapeFirstPressTimestamp && now - this.compositeEscapeFirstPressTimestamp <= 200) {
                this.compositeEscapeFirstPressTimestamp = undefined;
                yield vscode_1.default.commands.executeCommand("deleteLeft");
                this.onEscapeKeyCommand();
            }
            else {
                yield vscode_1.default.commands.executeCommand("default:type", { text: key });
            }
        });
        if (!neovimPath) {
            throw new Error("Neovim path is not defined");
        }
        this.mouseSelectionEnabled = mouseSelection;
        this.highlightProvider = new highlight_provider_1.HighlightProvider(highlightsConfiguration);
        this.disposables.push(vscode_1.default.commands.registerCommand("vscode-neovim.escape", this.onEscapeKeyCommand));
        this.disposables.push(vscode_1.default.workspace.onDidChangeTextDocument(this.onChangeTextDocument));
        this.disposables.push(vscode_1.default.window.onDidChangeVisibleTextEditors(this.onChangedEdtiors));
        this.disposables.push(vscode_1.default.window.onDidChangeActiveTextEditor(this.onChangedActiveEditor));
        this.disposables.push(vscode_1.default.window.onDidChangeTextEditorSelection(this.onChangeSelection));
        // this.disposables.push(vscode.window.onDidChangeTextEditorVisibleRanges(this.onChangeVisibleRange));
        this.typeHandlerDisplose = vscode_1.default.commands.registerTextEditorCommand("type", this.onVSCodeType);
        this.disposables.push(vscode_1.default.commands.registerCommand("vscode-neovim.ctrl-f", () => this.scrollPage("page", "down")));
        this.disposables.push(vscode_1.default.commands.registerCommand("vscode-neovim.ctrl-b", () => this.scrollPage("page", "up")));
        this.disposables.push(vscode_1.default.commands.registerCommand("vscode-neovim.ctrl-d", () => this.scrollPage("halfPage", "down")));
        this.disposables.push(vscode_1.default.commands.registerCommand("vscode-neovim.ctrl-u", () => this.scrollPage("halfPage", "up")));
        this.disposables.push(vscode_1.default.commands.registerCommand("vscode-neovim.ctrl-e", () => this.scrollLine("down")));
        this.disposables.push(vscode_1.default.commands.registerCommand("vscode-neovim.ctrl-y", () => this.scrollLine("up")));
        this.disposables.push(vscode_1.default.commands.registerCommand("vscode-neovim.compositeEscape1", (key) => this.handleCompositeEscapeFirstKey(key)));
        this.disposables.push(vscode_1.default.commands.registerCommand("vscode-neovim.compositeEscape2", (key) => this.handleCompositeEscapeSecondKey(key)));
        const neovimSupportScriptPath = path_1.default.join(extensionPath, "vim", "vscode-neovim.vim");
        const neovimOptionScriptPath = path_1.default.join(extensionPath, "vim", "vscode-options.vim");
        const args = [
            "-N",
            "--embed",
            // load options after user config
            "-c",
            useWsl ? `source $(wslpath '${neovimOptionScriptPath}')` : `source ${neovimOptionScriptPath}`,
            // load support script before user config (to allow to rebind keybindings/commands)
            "--cmd",
            useWsl ? `source $(wslpath '${neovimSupportScriptPath}')` : `source ${neovimSupportScriptPath}`,
        ];
        if (useWsl) {
            args.unshift(neovimPath);
        }
        if (parseInt(process.env.NEOVIM_DEBUG || "", 10) === 1) {
            args.push("-u", "NONE", "--listen", `${process.env.NEOVIM_DEBUG_HOST || "127.0.0.1"}:${process.env.NEOVIM_DEBUG_PORT || 4000}`);
        }
        if (customInit) {
            args.push("-u", customInit);
        }
        this.nvimProc = child_process_1.spawn(useWsl ? "C:\\Windows\\system32\\wsl.exe" : neovimPath, args, {});
        this.client = neovim_1.attach({ proc: this.nvimProc });
        this.statusLine = new status_line_1.StatusLineController();
        this.commandsController = new commands_controller_1.CommandsController(this.client);
        this.disposables.push(this.statusLine);
        this.disposables.push(this.commandsController);
        this.client.on("notification", this.onNeovimNotification);
        this.client.on("request", this.handleCustomRequest);
    }
    init() {
        return __awaiter(this, void 0, void 0, function* () {
            let resolveInitPromise = () => {
                /* ignore */
            };
            this.nvimInitPromise = new Promise(res => {
                resolveInitPromise = res;
            });
            yield this.client.setClientInfo("vscode-neovim", { major: 0, minor: 1, patch: 0 }, "embedder", {}, {});
            const channel = yield this.client.channelId;
            yield this.client.setVar("vscode_channel", channel);
            yield this.client.uiAttach(NVIM_WIN_WIDTH, NVIM_WIN_HEIGHT, {
                rgb: true,
                // override: true,
                /* eslint-disable @typescript-eslint/camelcase */
                ext_cmdline: true,
                ext_linegrid: true,
                ext_hlstate: true,
                ext_messages: true,
                ext_multigrid: true,
                ext_popupmenu: true,
                ext_tabline: true,
                ext_wildmenu: true,
            });
            // create empty buffer which is used when there is no active editor in the window
            const buf = yield this.client.createBuffer(true, false);
            if (typeof buf === "number") {
                throw new Error("Can't create initial buffer");
            }
            this.noEditorBuffer = buf;
            // vscode may not send ondocument opened event, send manually
            // // for (const doc of vscode.workspace.textDocuments) {
            // // if (doc.isClosed) {
            // // continue;
            // // }
            // // await this.onOpenTextDocument(doc);
            // // }
            const firstWin = yield this.client.window;
            // create nvim external windows. each window is mapped to corresponding view column
            // each window has own grid. IDs are starting from 1000 with first win is 1000 and second win is 1002 (why?)
            const requests = [
                ["nvim_set_var", ["vscode_primary_win", firstWin.id]],
                ["nvim_set_var", ["vscode_noeditor_buffer", this.noEditorBuffer.id]],
                ["nvim_buf_set_option", [this.noEditorBuffer.id, "modified", true]],
                ["nvim_win_set_buf", [0, this.noEditorBuffer.id]],
                ["nvim_win_set_option", [firstWin.id, "number", true]],
                ["nvim_win_set_option", [firstWin.id, "numberwidth", NUMBER_COLUMN_WIDTH]],
                ["nvim_win_set_option", [firstWin.id, "conceallevel", 0]],
            ];
            for (let i = 1; i < 20; i++) {
                requests.push([
                    "nvim_open_win",
                    [
                        this.noEditorBuffer.id,
                        false,
                        {
                            external: true,
                            width: NVIM_WIN_WIDTH,
                            height: NVIM_WIN_HEIGHT,
                        },
                    ],
                ]);
            }
            yield this.client.callAtomic(requests);
            const wins = yield this.client.windows;
            const winOptionsRequests = [];
            for (const w of wins) {
                winOptionsRequests.push(["nvim_win_set_var", [w.id, "vscode_clearjump", true]], ["nvim_win_set_option", [firstWin.id, "number", true]], ["nvim_win_set_option", [firstWin.id, "numberwidth", NUMBER_COLUMN_WIDTH]], ["nvim_win_set_option", [firstWin.id, "conceallevel", 0]]);
            }
            yield this.client.callAtomic(winOptionsRequests);
            let currColumn = 1;
            for (const w of wins) {
                this.editorColumnIdToWinId.set(currColumn, w.id);
                currColumn++;
            }
            this.watchAndApplyNeovimEdits();
            this.isInit = true;
            yield vscode_1.default.commands.executeCommand("setContext", "neovim.init", true);
            resolveInitPromise();
            for (const e of vscode_1.default.window.visibleTextEditors) {
                yield this.initBuffer(e);
            }
            // this.onChangedEdtiors(vscode.window.visibleTextEditors);
            yield this.onChangedActiveEditor(vscode_1.default.window.activeTextEditor, true);
        });
    }
    dispose() {
        for (const d of this.disposables) {
            d.dispose();
        }
        if (this.commandLine) {
            this.commandLine.dispose();
        }
        if (this.typeHandlerDisplose) {
            this.typeHandlerDisplose.dispose();
            this.typeHandlerDisplose = undefined;
        }
        this.client.quit();
    }
    initBuffer(e) {
        return __awaiter(this, void 0, void 0, function* () {
            const viewColumn = e.viewColumn;
            if (!viewColumn) {
                return;
            }
            const winId = this.editorColumnIdToWinId.get(viewColumn);
            if (!winId) {
                return;
            }
            const doc = e.document;
            const uri = doc.uri.toString();
            // todo: still needed?
            if (this.uriToBuffer.has(uri)) {
                const buf = this.uriToBuffer.get(uri);
                yield this.client.request("nvim_win_set_buf", [winId, buf.id]);
                return;
            }
            // this.documentChangesInInsertMode.set(uri, {});
            this.documentText.set(uri, e.document.getText());
            yield this.nvimInitPromise;
            let buf;
            if (this.pendingBuffers.has(uri)) {
                const bufId = this.pendingBuffers.get(uri);
                this.pendingBuffers.delete(uri);
                const buffers = yield this.client.buffers;
                buf = buffers.find(b => b.id === bufId);
            }
            else {
                // creating initially not listed buffer to prevent firing autocmd events when
                // buffer name/lines are not yet set. We'll set buflisted after setup
                const bbuf = yield this.client.createBuffer(false, true);
                if (typeof bbuf === "number") {
                    return;
                }
                buf = bbuf;
            }
            if (!buf) {
                return;
            }
            // this.currentNeovimBuffer = buf;
            this.managedBufferIds.add(buf.id);
            const eol = doc.eol === vscode_1.default.EndOfLine.LF ? "\n" : "\r\n";
            const lines = doc.getText().split(eol);
            const { options: { insertSpaces, tabSize }, } = e;
            const requests = [];
            requests.push(["nvim_win_set_buf", [winId, buf.id]]);
            requests.push(["nvim_buf_set_option", [buf.id, "expandtab", insertSpaces]]);
            // we must use tabstop with value 1 so one tab will be count as one character for highlight
            requests.push(["nvim_buf_set_option", [buf.id, "tabstop", insertSpaces ? tabSize : 1]]);
            // same for shiftwidth - don't want to shift more than one tabstop
            requests.push(["nvim_buf_set_option", [buf.id, "shiftwidth", insertSpaces ? tabSize : 1]]);
            // requests.push(["nvim_buf_set_option", [buf.id, "softtabstop", tabSize as number]]);
            requests.push(["nvim_buf_set_lines", [buf.id, 0, 1, false, lines]]);
            // if (cursor) {
            requests.push(["nvim_win_set_cursor", [winId, this.getNeovimCursorPosForEditor(e)]]);
            // }
            requests.push(["nvim_buf_set_var", [buf.id, "vscode_controlled", true]]);
            requests.push(["nvim_buf_set_name", [buf.id, uri]]);
            requests.push(["nvim_call_function", ["VSCodeClearUndo", [buf.id]]]);
            requests.push(["nvim_buf_set_option", [buf.id, "buflisted", true]]);
            // this.editorPendingCursor.set(e, { line: cursor.line, col: cursor.character, screenRow: 0, totalSkips: 0 });
            yield this.client.callAtomic(requests);
            this.bufferIdToUri.set(buf.id, uri);
            this.uriToBuffer.set(uri, buf);
            buf.listen("lines", this.onNeovimBufferEvent);
            return buf;
        });
    }
    normalizeKey(key) {
        switch (key) {
            case "\n":
                return "<CR>";
            case "<":
                return "<LT>";
            default:
                return key;
        }
    }
    normalizeString(str) {
        return str.replace("\n", "<CR>").replace("<", "<LT>");
    }
    multipleCursorFromVisualMode(append, visualMode, startLine, endLine, skipEmpty) {
        if (!vscode_1.default.window.activeTextEditor) {
            return;
        }
        if (this.currentModeName !== "visual") {
            return;
        }
        const currentCursorPos = vscode_1.default.window.activeTextEditor.selection.active;
        const newSelections = [];
        const doc = vscode_1.default.window.activeTextEditor.document;
        for (let line = startLine; line <= endLine; line++) {
            const lineDef = doc.lineAt(line);
            // always skip empty lines for visual block mode
            if (lineDef.text.trim() === "" && (skipEmpty || visualMode !== "V")) {
                continue;
            }
            let char = 0;
            if (visualMode === "V") {
                char = append ? lineDef.range.end.character : lineDef.firstNonWhitespaceCharacterIndex;
            }
            else {
                char = append ? currentCursorPos.character + 1 : currentCursorPos.character;
            }
            newSelections.push(new vscode_1.default.Selection(line, char, line, char));
        }
        this.leaveMultipleCursorsForVisualMode = true;
        vscode_1.default.window.activeTextEditor.selections = newSelections;
    }
    applyCursorStyleToEditor(editor, modeName) {
        const mode = this.vimModes.get(modeName);
        if (!mode) {
            return;
        }
        if ("cursorShape" in mode) {
            if (mode.cursorShape === "block") {
                editor.options.cursorStyle = vscode_1.default.TextEditorCursorStyle.Block;
            }
            else if (mode.cursorShape === "horizontal") {
                editor.options.cursorStyle = vscode_1.default.TextEditorCursorStyle.Underline;
            }
            else {
                editor.options.cursorStyle = vscode_1.default.TextEditorCursorStyle.Line;
            }
        }
    }
    attachNeovimExternalBuffer(name, id, expandTab, tabStop) {
        return __awaiter(this, void 0, void 0, function* () {
            // already processed
            if (this.bufferIdToUri.has(id)) {
                const uri = this.bufferIdToUri.get(id);
                const buf = this.uriToBuffer.get(uri);
                if (!buf) {
                    return;
                }
                const doc = vscode_1.default.workspace.textDocuments.find(d => d.uri.toString() === uri);
                if (doc) {
                    // vim may send two requests, for example for :help - first it opens buffer with empty content in new window
                    // then read file and reload the buffer
                    const lines = yield buf.lines;
                    const editor = yield vscode_1.default.window.showTextDocument(doc, {
                        preserveFocus: false,
                        preview: true,
                        viewColumn: vscode_1.default.ViewColumn.Active,
                    });
                    // need always to use spaces otherwise col will be different and vim HL will be incorrect
                    editor.options.insertSpaces = true;
                    editor.options.tabSize = tabStop;
                    // using replace produces ugly selection effect, try to avoid it by using insert
                    editor.edit(b => b.insert(new vscode_1.default.Position(0, 0), lines.join("\n")));
                    vscode_1.default.commands.executeCommand("editor.action.indentationToSpaces");
                }
                return;
            }
            // if (!name) {
            // return;
            // }
            const buffers = yield this.client.buffers;
            // get buffer handle
            const buf = buffers.find(b => b.id === id);
            if (!buf) {
                return;
            }
            // :help, PlugStatus etc opens new window. close it and attach to existing window instead
            const windows = yield this.client.windows;
            const possibleBufWindow = windows.find(w => ![...this.editorColumnIdToWinId].find(([, winId]) => w.id === winId));
            if (possibleBufWindow && vscode_1.default.window.activeTextEditor) {
                const winBuf = yield possibleBufWindow.buffer;
                if (winBuf.id === buf.id) {
                    const column = vscode_1.default.window.activeTextEditor.viewColumn || vscode_1.default.ViewColumn.One;
                    const winId = this.editorColumnIdToWinId.get(column);
                    yield this.client.callAtomic([
                        ["nvim_win_set_buf", [winId, buf.id]],
                        ["nvim_win_close", [possibleBufWindow.id, false]],
                    ]);
                    // await this.client.request("nvim_win_close", [possibleBufWindow.id, false]);
                }
            }
            // we want to send initial buffer content with nvim_buf_lines event but listen("lines") doesn't support it
            const p = buf[Buffer_1.ATTACH](true);
            this.client.attachBuffer(buf, "lines", this.onNeovimBufferEvent);
            yield p;
            // buf.listen("lines", this.onNeovimBufferEvent);
            const lines = yield buf.lines;
            // will trigger onOpenTextDocument but it's fine since the doc is not yet displayed and we won't process it
            const doc = yield vscode_1.default.workspace.openTextDocument({
                content: lines.join("\n"),
            });
            const uri = doc.uri.toString();
            this.uriToBuffer.set(uri, buf);
            this.bufferIdToUri.set(id, uri);
            if (!lines.length || lines.every(l => !l.length)) {
                this.externalBuffersShowOnNextChange.add(buf.id);
            }
            else {
                const editor = yield vscode_1.default.window.showTextDocument(doc, {
                    preserveFocus: false,
                    preview: true,
                    viewColumn: vscode_1.default.ViewColumn.Active,
                });
                // need always to use spaces otherwise col will be different and vim HL will be incorrect
                editor.options.insertSpaces = true;
                editor.options.tabSize = tabStop;
                vscode_1.default.commands.executeCommand("editor.action.indentationToSpaces");
            }
        });
    }
    /**
     *
     * @param hlGroupName VIM HL Group name
     * @param decorations Text decorations, the format is [[lineNum, [colNum, text][]]]
     */
    applyTextDecorations(hlGroupName, decorations) {
        const editor = vscode_1.default.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const decorator = this.highlightProvider.getDecoratorForHighlightGroup(hlGroupName);
        if (!decorator) {
            return;
        }
        const conf = this.highlightProvider.getDecoratorOptions(decorator);
        const options = [];
        for (const [lineStr, cols] of decorations) {
            try {
                const lineNum = parseInt(lineStr, 10) - 1;
                const line = editor.document.lineAt(lineNum).text;
                for (const [colNum, text] of cols) {
                    // vim sends column in bytes, need to convert to characters
                    // const col = colNum - 1;
                    const col = Utils.convertByteNumToCharNum(line, colNum - 1);
                    const opt = {
                        range: new vscode_1.default.Range(lineNum, col, lineNum, col),
                        renderOptions: {
                            before: Object.assign(Object.assign(Object.assign({}, conf), conf.before), { contentText: text }),
                        },
                    };
                    options.push(opt);
                }
            }
            catch (_a) {
                // ignore
            }
        }
        editor.setDecorations(decorator, options);
    }
    handleVSCodeCommand(command, args) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.runVSCodeCommand(command, ...args);
        });
    }
    /**
     * Produce vscode selection and execute command
     * @param command VSCode command to execute
     * @param startLine Start line to select. 1based
     * @param endLine End line to select. 1based
     * @param startPos Start pos to select. 1based. If 0 then whole line will be selected
     * @param endPos End pos to select, 1based. If you then whole line will be selected
     * @param leaveSelection When true won't clear vscode selection after running the command
     * @param args Additional args
     */
    handleVSCodeRangeCommand(command, startLine, endLine, startPos, endPos, leaveSelection, args) {
        return __awaiter(this, void 0, void 0, function* () {
            const e = vscode_1.default.window.activeTextEditor;
            if (e) {
                // vi<obj> includes end of line from start pos. This is not very useful, so let's check and remove it
                // vi<obj> always select from top to bottom
                if (endLine > startLine) {
                    try {
                        const lineDef = e.document.lineAt(startLine - 1);
                        if (startPos > 0 && startPos - 1 >= lineDef.range.end.character) {
                            startLine++;
                            startPos = 0;
                        }
                    }
                    catch (_a) {
                        // ignore
                    }
                }
                this.shouldIgnoreMouseSelection = true;
                const prevSelections = [...e.selections];
                // startLine is visual start
                if (startLine > endLine) {
                    e.selections = [
                        new vscode_1.default.Selection(startLine - 1, startPos > 0 ? startPos - 1 : 9999999, endLine - 1, endPos > 0 ? endPos - 1 : 0),
                    ];
                }
                else {
                    e.selections = [
                        new vscode_1.default.Selection(startLine - 1, startPos > 0 ? startPos - 1 : 0, endLine - 1, endPos > 0 ? endPos - 1 : 9999999),
                    ];
                }
                const res = yield this.runVSCodeCommand(command, ...args);
                if (!leaveSelection) {
                    e.selections = prevSelections;
                }
                this.shouldIgnoreMouseSelection = false;
                return res;
            }
        });
    }
    handleExtensionRequest(command, args) {
        return __awaiter(this, void 0, void 0, function* () {
            switch (command) {
                case "external-buffer": {
                    const [name, idStr, expandTab, tabStop, isJumping] = args;
                    const id = parseInt(idStr, 10);
                    if (!this.managedBufferIds.has(id) && !(name && /:\/\//.test(name))) {
                        yield this.attachNeovimExternalBuffer(name, id, !!expandTab, tabStop);
                    }
                    else if (isJumping && name) {
                        // !Important: we only allow to open uri from neovim side when jumping. Otherwise it may break vscode editor management
                        // !and produce ugly switching effects
                        try {
                            let doc = vscode_1.default.workspace.textDocuments.find(d => d.uri.toString() === name);
                            if (!doc) {
                                doc = yield vscode_1.default.workspace.openTextDocument(vscode_1.default.Uri.parse(name, true));
                            }
                            this.skipJumpsForUris.set(name, true);
                            yield vscode_1.default.window.showTextDocument(doc, {
                                // viewColumn: vscode.ViewColumn.Active,
                                // !need to force editor to appear in the same column even if vscode 'revealIfOpen' setting is true
                                viewColumn: vscode_1.default.window.activeTextEditor
                                    ? vscode_1.default.window.activeTextEditor.viewColumn
                                    : vscode_1.default.ViewColumn.Active,
                                preserveFocus: false,
                                preview: false,
                            });
                        }
                        catch (_a) {
                            // todo: show error
                        }
                    }
                    break;
                }
                case "text-decorations": {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const [hlName, cols] = args;
                    this.applyTextDecorations(hlName, cols);
                    break;
                }
                case "reveal": {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const [at, updateCursor] = args;
                    this.revealLine(at, !!updateCursor);
                    break;
                }
                case "move-cursor": {
                    const [to] = args;
                    this.goToLine(to);
                    break;
                }
                case "scroll": {
                    const [by, to] = args;
                    this.scrollPage(by, to);
                    break;
                }
                case "scroll-line": {
                    const [to] = args;
                    this.scrollLine(to);
                    break;
                }
                case "visual-edit": {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const [append, visualMode, startLine1Based, endLine1Based, skipEmpty] = args;
                    this.multipleCursorFromVisualMode(!!append, visualMode, startLine1Based - 1, endLine1Based - 1, !!skipEmpty);
                    break;
                }
                case "open-file": {
                    const [fileName, close] = args;
                    const currEditor = vscode_1.default.window.activeTextEditor;
                    let doc;
                    if (fileName === "__vscode_new__") {
                        doc = yield vscode_1.default.workspace.openTextDocument();
                    }
                    else {
                        doc = yield vscode_1.default.workspace.openTextDocument(fileName.trim());
                    }
                    if (!doc) {
                        return;
                    }
                    let viewColumn;
                    if (close && close !== "all" && currEditor) {
                        viewColumn = currEditor.viewColumn;
                        yield vscode_1.default.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
                    }
                    yield vscode_1.default.window.showTextDocument(doc, viewColumn);
                    if (close === "all") {
                        yield vscode_1.default.commands.executeCommand("workbench.action.closeOtherEditors");
                    }
                    break;
                }
                case "notify-recording": {
                    this.isRecording = true;
                    break;
                }
                case "insert-line": {
                    const [type] = args;
                    // need to ignore cursor update to prevent cursor jumping
                    this.ignoreNextCursorUpdate = true;
                    yield this.client.command("startinsert");
                    yield vscode_1.default.commands.executeCommand(type === "before" ? "editor.action.insertLineBefore" : "editor.action.insertLineAfter");
                    // grid_cursor_goto will unset it, butt let's make sure
                    this.ignoreNextCursorUpdate = false;
                    break;
                }
            }
        });
    }
}
exports.NVIMPluginController = NVIMPluginController;
//# sourceMappingURL=controller.js.map