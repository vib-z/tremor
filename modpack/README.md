# tremor: a T3-style layout and mod pack for the Herdr app

A layout for the official Herdr desktop app (0.1.15). The sidebar is Herdr's own workspaces, tabs and splits as a thin
tree (workspace, then tab, then pane, with Core sub-agents under their parent's pane), one row per agent with its own
mark and status. Above it, the machine selector (All, This computer, each machine, then Add machine), and the
Workspaces row whose one "+" makes a workspace named after its folder with an agent already running. Then a Cmd+K /
Cmd+P palette with one destination per running agent; two icon-only toggles (Chat / Terminal on each agent's bar, Grid / Factory in the tab bar); a structured chat for
agents whose transcript format is known (with previews of the images, videos, PDFs and HTML files it names, a
"+" that adds files and folders from the agent's machine, "/" commands, an expandable code view, a session-only model switcher for Claude and Codex, Stop,
and approval/question cards that show the request and point to the terminal); a factory mind map of the agents actually
running, the full width. Workspaces, tabs and panes use Herdr's own menus, rename prompt and close confirmation; Add
machine and Settings are Herdr's own too. The sidebar's foot shows usage per machine, and its gear opens Herdr's
Settings; a one-page guide (`pdk-guide`) says the rest. Twenty-four themes from one colour-token set (T3 light, T3
dark, Moshi and twenty-one presets), picked in Herdr's own Settings. Agents show their own marks, in our surfaces and
(through `programs.json`) in Herdr's own; everything else uses Lucide glyphs. One design system (`shared/ui.js`: the
visual contract's tokens and components, ported from shadcn/ui and T3 Code) sizes every surface, enforced by
`test/scale.test.js`. Styled after T3 Code, Claude Desktop and Moshi.
The chat's live feed and thread (November 2026) were informed by studying slopus/happy, d-kimuson/claude-code-viewer, BloopAI/vibe-kanban,
stablyai/orca, ZacxDev/muster and T3 Code's thread: ideas only. That code is written fresh for tremor under MIT; no code or test fixtures from those
projects are included.
Internal ids keep the `pdk-` prefix: mods, themes, `pdk/`, `pdk-state/`, `.pdk-backup/` and the `pdk.*` shared keys.

## Install, switch, remove

```sh
# The live profile: quit the app first.
modpack/install.sh --live ~/.config/herdr-app
herdr-app do layout.switch --name tremor         # once the app is open again (or pick tremor in the layout switcher)
modpack/uninstall.sh --live ~/.config/herdr-app  # app quit; restores what the first install replaced

# Any other home, e.g. a sandbox (without --live, both refuse ~/.config/herdr-app and any alias to it):
modpack/install.sh <app home>
HERDR_APP_HOME=<app home> herdr-app do layout.switch --name tremor
modpack/uninstall.sh <app home>                  # a second run is a no-op
```

Upgrading from the pdk-era pack: install over it as above. It removes `layouts/pdk.json` and the `layout:pdk` Cmd+K block
when each is unchanged since that install, and adds `tremor`; if either was changed it refuses before changing anything
(move the file out of the home, or run `uninstall.sh --live` from the old checkout first). The app then opens on Herdr's
`main` layout until you switch to tremor.

Both refuse a home whose window is running (its socket accepts a connection), and any symbolic link below the
home on the way to a file they read or write, the backup folder included. The first install keeps a baseline of
any file it replaces in `<home>/.pdk-backup/`; installed files are recorded with sha256 hashes; uninstall refuses if
you changed one, except a theme file you edited: install keeps it, uninstall saves it in
`<home>/pdk-state/themes/`. Uninstall cleans only folders its manifest owns, and removes the chat's preview cache
`<home>/pdk-cache/media`. Your other layouts, Herdr's shipped mods and your settings are never touched. Runtime
state (saved theme edits) lives in `<home>/pdk-state/` and survives uninstall.

Needs: Herdr app 0.1.15, herdr-core 0.1.20, macOS, `/usr/bin/python3` (the helper), `ps`, `lsof`, `sips` and `qlmanage` (previews). Chat for an agent on another machine needs that machine to be a Mac with `python3`, `ps` and `lsof` (and `sips`, `qlmanage` for its previews).

## What is in it

| Path | What |
|---|---|
| `layouts/tremor.json` | Cloned from shipped `main` 0.1.14: the sidebar (top strip, tree, usage foot), the tab bar, and a stack of the active tab, the chat and the factory; its `preview` is `pdk/icons/tremor-preview.svg` |
| `themes/pdk-t3-{light,dark}.json`, `themes/pdk-moshi.json` | One token set (Herdr's own colour names, `adapters/tokens.js`), every token defined by all of the pack's themes. T3 light and dark follow the system; Moshi (dark, neon green) is a theme in Herdr's picker. Text meets WCAG AA on every surface (tested) |
| `themes/pdk-t3-blue-light.json`, `pdk-t3-navy`, `pdk-t3-magenta`, `pdk-moshi-forest`, `pdk-moshi-amber` | Presets: the palettes tried during testing, each finished into a whole theme on the same tokens (`PRESET_SOURCES` in `adapters/tokens.js` records where each came from). In Herdr's own theme picker |
| `themes/pdk-t3-blue-sidebar-{light,dark}.json`, `pdk-t3-glass-{light,dark}` | Only the sidebar blue (the edit tried in testing), and its translucent variant. The window is opaque (herdr-app `src/main.rs:205-228`), so "glass" is the sidebar colour with alpha over `backgrounds/busy.png`, which the layout paints behind it: the desktop never shows through and nothing is blurred. Picked like any other theme |
| `backgrounds/busy.png` | The layout's backdrop behind a translucent sidebar; the pack's own generated image (`make-busy.py`) |
| `mods/pdk-tree` | The sidebar (spec §2, §3). The 40px top strip: Search (⌘K) and the sidebar toggle (⌘B) at its right end. The machine selector, after shadcn's sidebar switcher: a full-width 32px row button with a 1px edge (the chosen one's glyph, its name, up-down chevrons at its right end; All reads All machines) opening a menu as wide, of All, This computer and each machine, then Add machine (`pdk-machine-add`); it sets the machine filter `pdk.machine.filter` the tree, tab bar, palette, factory and usage foot read, and shows with one machine too. The Workspaces row with the one + (`pdk-tree.new-workspace`). Then the filter's workspaces; under each its tabs (each folds), under a split tab its panes on thin lines, under a pane its Core sub-agents (`parent`) and 7501 in-process records. A tab row starts at its workspace name's left edge; a child row keeps its indent and tree lines. Each is the agent's mark and its name, its status marker alone at the right end (the word its tooltip). Right-click opens Herdr's own menu (an agent row: the pack's Pin and Mark unread) |
| `mods/pdk-machine-add` | Herdr's own Add a machine dialog: `stock.js` is Herdr 0.1.15's `mods/machine-add/main.js` byte for byte (`test/machine-add.test.js` pins its sha256 and the app version); `main.js` changes two things. An add that needs an answer (a new host key, a password, installing herdr-core there) runs `hc machine add <host>` in a Herdr terminal shown over the dialog (a layout overlay with the host and Cancel above the terminal), where the person answers; done, the terminal and the dialog close and the new machine's tab is chosen (`pdk-tree.machine:<name>`); refused or cancelled (Cancel, or Ctrl+C in the terminal), one line ("Couldn't add <host>." or "Cancelled.") and Retry; a cancel removes no machine. An add that needs no answer stays one quiet click, as in stock, and also ends on the new machine's tab |
| `mods/pdk-search` | The Cmd+K palette (`keys.json` binds `cmd-k` and `cmd-p` for the tremor layout only): Places (one destination per running agent, with its workspace and machine, then workspaces, tabs and panes) and Commands (`>`), ⌥↵ for the Actions of the chosen one. A pick on another machine moves the machine filter, unless All is on |
| `mods/pdk-usage` | The sidebar's foot: per machine (as the machine filter `pdk.machine.filter` picks) its label, then per installed agent its mark, the percentage used, the reset time and a bar the foot's width; "-" when it can't be read (Claude Code, wherever it is installed: "Sign in" or "Can't read"; not installed, no line), "stale" on a value kept from a failed read; at most 40% of the sidebar, more scrolls. Usage only from local tools' own commands, read on the machine it belongs to (see below). The gear opens Herdr's own Settings (`app.settings`) |
| `mods/pdk-tabs` | The tab bar: 28px tabs of the shown workspace (drag, double-click to rename, right-click for Herdr's menu, × on the shown or hovered tab), + for the new-tab menu, the Grid / Factory toggle; a shown tab comes back as it was left, Chat with its agent or its panes (`pdk.chat.tabs`) |
| `mods/pdk-pane` | The 33px pane header: the agent's mark, the pane's name, the status marker, the folder's own name (the whole path its tooltip); split right, split down, expand and close as icon buttons on hover (an expanded pane keeps them in view, Restore pressed); an agent's pane has the Chat / Terminal toggle in the middle of its bar |
| `mods/pdk-chat` | The chat for the agent of the pane whose Chat was pressed (or picked in the sidebar), full width, on this Mac or another machine: timeline, tool work, observed status, the blocked request verbatim, the composer; a sent message shows at once, dim, "Sending…", until its transcript records it; media tiles under the rows that name an image, video, PDF or HTML file (agents on this Mac); the newest turns that fit, with "Show N earlier" above. Each tool call is one line (verb, detail, a one-line result, status) that opens to its name, Arguments, Changes and Result as read-only highlighted snippets; fenced code in an answer is a highlighted snippet. Media sits in fixed frames that never move as previews land (a remote agent's made on its machine). The newest row stays in view until a person scrolls, opens a call or asks for earlier rows; "Show the latest only" follows again. Each agent's chat (its reader, open rows, draft) is kept while another is shown, up to 8 |
| `mods/pdk-preview` | The preview dialog a tile opens: Fit, zoom, 100%, Open or Play in the default app, Reveal in Finder; a remote image is fetched only after that click |
| `mods/pdk-factory` | The mind map, the full width (the sidebar already lists everything): machine and workspace heads; each agent a node (its mark, its pane's name, its status marker and time, its own last 7501 message verbatim, history on click), read left to right along Core-recorded starts only; in-process sub-agents on dashed cards; plain shells folded into a count. It shows the machine filter's machines. A Map / Board toggle puts the Map first (`map.js`): the agents as a star map by Core parent, Collapsed in levels (Fleet, Jobs, Team, Agent) or Expanded with every agent under a zoom-and-drag camera |
| `adapters/` | Pure JavaScript: status and tree model (`rowSpec`), binding by evidence, transcript mappers and thread, cursor and view gate, composer guard, tokens and themes, media references and preview queue, the chat's tail, the board model. `bun test` runs them |
| `shared/` | The design system (`ui.js`: the visual contract's tokens and the components every mod draws with, ported from shadcn/ui and T3 Code onto gpui-base), the one exec call (`helper.js`), evidence gathering (`sessions.js`) |
| `helper/pdk-helper.py` | The chat and tree helper: fixed commands, allow-listed paths; it writes only its preview cache and fetches only an image a person clicked (see its header) |
| `helper/pdk-usage.py` | The usage helper: runs local tools' own usage commands (below), masks emails and drops account ids, transcript-derived text and cost blocks before anything reaches the mod. Claude usage is always on, as CodeNotch does it: every 5 minutes, on this computer and on each connected machine, it runs `claude --print --no-session-persistence --strict-mcp-config --setting-sources project,local "/usage"` from one fixed scratch folder against that machine's home, which reads Claude's own local session data to answer. Installed means `claude` on PATH, in `~/.local/bin` or `~/.claude/local`, or a `~/.claude` folder. Signed out, `/usage` is not run and the foot says "Sign in". On a Mac reached over ssh Claude reads as signed out (its login keychain is closed to that session), so the same read runs once more as a one-off launchd job in that Mac's desktop session (`launchctl bootstrap gui/<uid>`): the helper's own text in a private folder made for that read (mkdtemp, mode 700), a new label per read, 40 s at most; no desktop session, "Sign in". Every read in the helper shares one deadline (70 s, with 10 s kept for teardown, inside the app's 90 s). The job is torn down from both sides: the helper boots it out and removes its folder once it has the answer or gives up (if bootout fails, the files stay for the job and the helper says so on stderr), and once the job ends its own cleaner (its own session, so the job's end does not end it) boots it out, three tries, and only then removes its folder, so a killed helper leaves nothing loaded; when the cleaner cannot, the folder stays as the record. Each desktop read first sweeps this user's `dev.tremor.usage.<time>.*` jobs and `pdk-usage-<time>-*` folders older than 300 s (older than any read can live; a younger one may be another read's and is left alone). No standing job, cache or token. The usage helper itself never reads transcripts or credentials (the chat reads agents' own transcripts, as the table under "What each mod reads and runs" says) |
| `keys.json` | `{"layout:tremor": {"cmd-k": "mod.open:pdk-search", "cmd-p": "mod.open:pdk-search"}}`, merged into the home's keys by install (a custom key already used is reported and skipped; the exact stock global Cmd+P picker is intentionally shadowed only in pdk, while main and other layouts keep it) and removed byte for byte by uninstall. Editing keys.json makes it the person's own, so later Herdr versions stop adding new default shortcuts to it (AGENTS.md:479-481) |
| `pdk-programs.json` | App-wide agent visual overlay merged into the home's `programs.json` through Herdr's documented field-by-field override (herdr-app@2405bf3 `defaults/AGENTS.md:744-775`). Twelve stock agent keys receive a coloured Moshi SVG picture (`tint:false`) in `pdk/icons/agents-colour/`, with one fixed same-hue fill that passes 3:1 on native resting light/dark menu/sidebar grounds; no backing. The pack's own `icons/agents/` masks and per-theme shading stay unchanged. No name/run/match changes. An existing icon/tint/color/tile skips that entire entry. Both shared files use exclusive no-follow temporary writes; install backs up once, repeats are idempotent and uninstall removes exact journalled blocks. Unedited pack-created files are removed; unrelated bytes/edits are kept. These logos apply in **every layout**; the native picture retains its colour instead of inheriting text colour. Hover/selected exceptions and exact numbers are in `icons/agents-colour.json`. Unsupported stock keys are left alone. |
| `icons/` | Lucide glyphs, 1.75px strokes. In use: chat and terminal (one toggle), grid (`layout-grid`) and factory (the other), the sidebar toggle (`panel-left`), search, settings (the usage foot's gear), the folding carets (`caret-right`, `caret-down`) and the pane header's controls (`columns-2`, `rows-2`, `maximize-2`, `minimize-2`, `x`: the shapes Herdr's own pane mod draws), `plus`, `x` and `minus` where a button would draw "+", "×" or "−" (a font sets those below the middle), `monitor` (this computer, in the machine selector and on its workspaces under All) and `server` (another machine, in the selector), `chevrons-up-down` (the selector's trigger), `working`, `working-dense` and `working-still` (the pack's own spinner: a faint track with a turning arc, its 7 px drawing, and the three still dots shown under Reduce Motion); `list-tree`, `bot`, `git-branch` and `square-slash` still ship but nothing draws them. `tremor-preview.svg` is the layout's picture in Herdr's Settings. `icons/agents/` holds the agents' own marks (LobeHub MIT, Factory Apache-2.0, see NOTICE.md; trademarks stay their owners'). An agent shows its own mark and a plain terminal the terminal mark (`kindMarker`, `shared/ui.js`), never a two-letter monogram. Status is one system everywhere (`statusMarker`, owner request 7): the shared spinner while working (`spinner`, `icons/working*.svg`, the one moving mark, three still dots under Reduce Motion; `workingText` sweeps a highlight across a status word), a green dot when done and not yet seen, a yellow dot when it needs you, a hollow grey ring when idle; no flag anywhere. Every mark and marker has its words in the accessible name. `icon()` draws nothing for any other name |
| `install.sh`, `uninstall.sh`, `install-lib.sh` | Install and rollback |
| `test/` | `bun test modpack/test`, plus the sandbox scripts below |

install.sh copies `adapters/*.js` and `shared/*.js` into each mod's `lib/` (a mod imports only from its own folder).

## Every visible control, against the owner's requirements (plan R1 to R11, M9)

Letters are the owner's 9 Nov morning requests (`ask-2026-11-09.md`); plain numbers are the evening ones (`ask-2026-11-09-evening.md`).

| Control | Where | Requirement |
|---|---|---|
| Sidebar top strip: Search (⌘K) and the sidebar toggle (⌘B) at its right end, each with a short tooltip and its key; the empty strip drags the window; the tab bar carries the toggle while the sidebar is hidden | sidebar top, tab bar | 4a; spec §2 |
| Machine selector: All, This computer, then each machine by name, the current one marked, then Add machine; with one machine it reads This computer; picking one shows only its work in the tree, tab bar, palette, factory and usage foot (`pdk.machine.filter`); an offline machine stays listed, said Offline, and one that needs a login says Sign in and opens Herdr's Settings at Machines | sidebar, under the top strip | owner 22:15 (option C); owner 11 Nov ("a minimal dropdown with icons"); spec §2 |
| Workspaces row and its one + (`pdk-tree.new-workspace`): a workspace named after its folder (the machine's focused, else last, else home folder) with the last-used installed agent running (else Claude, Codex, the first installed); "No agents installed", "Folder unavailable" and an offline machine make nothing | sidebar | owner 20:38 ("one + gives a named workspace with an agent running"); spec §3 |
| Workspace row: its name (13/500), the caret after it folds it; under All with two machines its machine at the right; the branch, ↑ahead ↓behind and * (not committed) from git's own answer; drag reorders; right-click opens Herdr's own workspace menu (Rename asks with Herdr's prompt, Close with its confirmation) | tree | B, R4, 6, 8e, owner 20:44; spec §2, §5 |
| Tab row: an agent-led tab is its lead agent's mark, then the tab's own name (an unnamed tab shows its lead pane's name; the kind is in the mark and the accessible name); a single pane folds into its tab, a split tab lists its panes under it; click shows the tab and focuses its pane. The tab bar uses the same naming (`tabLabel`, `adapters/status.js`) | tree, tab bar | B (sidebar mapping, owner-approved 05c691346ef8), 14 |
| Tab and pane rows: the agent's mark (14), then its name; at the right end the status marker alone, its word (Working, Ready, Done, Needs you) the tooltip and, with the time, in the accessible name; a caret only where rows sit under it; a shell pane reads Terminal; click shows its tab and focuses the pane; a tab row's × on hover or selection closes it (Herdr asks first) | tree | B, R3, R4; spec §2 |
| Sub-agent and in-process rows: click focuses, peeks or shows its chat | tree | R3 |
| Status marker (7px, still) with its word in the accessible name, the same `statusMarker` everywhere | tree, tabs, pane header, chat, factory | R3, 7; visual contract |
| Tab: click selects, drag reorders, double-click renames (Herdr's prompt), right-click opens Herdr's tab menu; × on the shown or hovered tab | tab bar | R4 (Herdr's tab behaviour) |
| + (New tab, ⌘T): the agents installed where the shown workspace runs and Terminal, as a new tab there, then New workspace (the sidebar's +); 1 to 9 start the agents in order | tab bar | R4; spec §3, §5 |
| Chat / Terminal toggle, icons only (words in its tooltip and accessible name): Terminal is lit on a pane, Chat shows that agent's chat; in the chat Chat is lit and Terminal goes back to its pane. Each tab remembers which it showed, and the agent (`pdk.chat.tabs`, adapters/views.js followTab); Terminal and Grid forget it. A plain shell's pane has none | an agent's pane header and the chat header, in the middle | R8, 3b; owner 11 Nov |
| The machine's name before the tabs when the shown workspace isn't on this computer | tab bar start | 1 |
| Grid / Factory toggle, icons only: Grid is the split pane view (the shown tab's panes), the same view Terminal shows; a segment is lit while its view is on screen | tab bar end | R9; owner 11 Nov |
| Window buttons (only where the system draws none) | tab bar end | R1 (shipped behaviour kept) |
| Split right, Split down, Expand and Close as icon buttons, each with its key in the tooltip; on an expanded pane Expand reads Restore and the four stay in view | pane header, on hover | R4 (Herdr's split behaviour, `pane.zoom`); owner 11 Nov |
| Answer in the terminal; Open or Use the terminal | blocked card (approval and question cards show the pending action or the question's own choices, read only); the labelled fallbacks | R6, D35, request 35 |
| Stop (while the agent works) | chat composer, beside Send | request 35 (`hc interrupt` once per turn, after re-checking the terminal, process, session, turn and that it still works) |
| Hook events (quiet rows) | chat timeline | request 35 (display only: Claude's hook attachments and Stop summary, Codex's hook prompts) |
| Worked group fold; a tool row opens its output | chat | R6, R7 |
| Show N earlier / Show the latest only | chat | D (the newest turns that fit) |
| Media tile: a click opens the preview; a large file or inline image loads on a click; a remote image reads "Not loaded" until clicked | chat | C |
| Preview dialog: Fit, −/+, 100%, Open / Play in default app / Open in browser, Reveal in Finder, Close, Esc | preview dialog | C |
| Composer and Send; the draft belongs to its session; a sent message shows at once as a dim "Sending…" row until its transcript records it (15 s at most); "Reconnecting to <machine>…" above it while that machine is unreachable, and it still sends | chat | R6 (guarded by Core), PM R1; owner 11 Nov |
| "+" opens the file browser (`pdk-files`, a clone of Herdr's files tree) on the agent's machine: tick files or folders (owner, 11 Nov 2026) | composer | 16, 26, 27 |
| "/" commands menu (insert, never send); for an agent on another machine, its built-in commands only | composer | 30; owner 11 Nov (the pane header's "/" button is gone) |
| Code view: a file-changing tool row expands to per-file diffs from the record's own data | chat | 34 |
| Stop (interrupts that turn once); approval and question cards (display-only: "Answer in the terminal", see Limits); hook rows (display-only) | chat | 35 |
| Agent menu "⋯": Open in terminal, Peek, Keep, Focus owner, Stop turn, End terminal | chat header | PM G6 |
| Right-click menus: a workspace, tab or pane opens Herdr's own menu; an agent row the pack's short one (Pin, Mark unread); Files, Changes and worktrees from Cmd+K | tree, tab bar | owner 21:00 ("use herdrs own"); spec §5 |
| Files and Changes dialog (browse, bounded previews, git diff, explicit "Commit all changes") | dialog | 32 (G1) |
| Cmd+K Places (one destination per running agent, with its workspace and machine) / Commands (">") and ⌥↵ Actions for the chosen result; the command form for named arguments; a pick on another machine moves the machine filter unless All is on | palette | 32 (G3); assessment rank 7; spec §2 |
| Add machine (Herdr's own dialog, from Cmd+K and from the machine selector's last entry; from the sidebar an add that needs an answer continues in a Herdr terminal in the app and ends on the new machine's tab); the gear (Herdr's own Settings, ⌘,); the one-page guide (`pdk-guide`) | palette, sidebar, sidebar foot, dialog | 19; owner 21:00; owner 11 Nov ("Add machine entry pinned at the bottom of the left sidebar", "Clicking Add must handle this itself"); spec §5 |
| Model chip "model · effort" and its switcher (Claude and Codex, session only; read-only for other agents) | composer | 16 |
| Cmd+K / Cmd+P palette: type, ↑/↓, Enter, Esc | overlay | 4b |
| Usage foot: per machine its label, per installed agent its mark, "49% · resets 1d 11h" and a full-width bar; "-" when it can't be read; Claude Code wherever it is installed, "Sign in" or "Can't read" when it can't be; no tooltip | sidebar foot | owner 20:42, 20:47, option A; spec §4; owner 11 Nov ("every machine must show Claude usage by default whenever Claude is installed there") |
| Factory: the map the full width, the machine filter's machines; a node click selects it and shows its history under the map; arrows move the selection, Enter focuses or peeks the owner's pane, Esc clears | factory | E, 11, 12, 17; owner ask (no side pane); spec §6 |

Removed from the clones: Files and Changes buttons and panels, the status bar, the spaces and agents sidebars (M9).
Gone on 10 Nov: Put away and Settled, the agents view, machine rows and Hide, the Colours editor and tremor's settings popover.
Nothing else is added: no inbox, snooze, approval buttons or motion switch.

**Approvals and questions are answered in the terminal (request 35's known limit).** The chat shows what a
permission prompt or a question asks, from the agent's own record (Claude's pending call or AskUserQuestion), but
presses no key: Core has no way to press a key only while one exact prompt is still open (`hc keys` takes no
precondition; `hc send --if` knows idle and working only and always adds Enter). A key sent after any re-read could
land on the next prompt, which Claude also answers "1" for Yes. Closing that needs a guarded Core command (press
these keys only if this terminal is still blocked on this turn, status time and message); there is none, and no Core
change is made without the owner.

Bindable commands (keys.json `"<key>": "<mod>.<command>"`, also `herdr-app do <mod>.<command>`):
`pdk-tree.new-workspace` (the +), `pdk-tree.new-workspace:<local|name>` (one on that machine),
`pdk-tree.machine:<all|local|name>` (the machine filter; it reads `hc machine ls` again), `pdk-machine-add.add:<host>` (while the dialog is open: a click on that host's Add or Retry), `pdk-tree.fold:<row key>`, `pdk-tree.pick:<row key>`,
`pdk-tree.menu:<row key>` (row keys `sp:<space>`, `tb:<tab>`, `pn:<pane>`, `tm:<terminal>`: the same as a click or
right-click on that row), `pdk-tree.key:<key>` (a key pressed in the tree), `pdk-tree.connect:<machine>` (reconnect a
rebuilt machine), `pdk-usage.refresh`, `pdk-chat.preview[:n]` (a click on the n-th newest tile), `pdk-chat.send:<text>` (Send with that text), `pdk-chat.call:<n>` (a click on the n-th call or thought), `pdk-chat.group:<n>` (a click on the n-th work group),
`pdk-preview.zoom-in|zoom-out|fit|actual|open|reveal|close`, `pdk-factory.select`, `pdk-factory.select:<terminal>`,
`pdk-factory.deselect`, `pdk-factory.next|previous`. The tree, chat and factory are focusable (`pane.go`); the tree
moves with the arrow keys, Enter activates, Left and Right fold.

## What each mod reads and runs (R11)

| Mod | Reads | Runs |
|---|---|---|
| pdk-tree | live app state; the machine filter; each open workspace's git state (branch, ahead and behind, uncommitted changes) on its own machine | the helper (`motion` once a minute, for Reduce Motion); `git --no-optional-locks -c core.fsmonitor=false status --porcelain=v2 --branch` in each open workspace's folder on its own machine, local or remote, every 15 s while the window is in front (it writes nothing under `.git`, as Herdr's own spaces mod asks it); `hc machine ls --json`; for the +, on the chosen machine through `exec(..., { on })`: `test -d <folder>` and `printenv HOME`, then `knownAgents` and `space.new`, or the local folder picker when nothing fits; `hc machine rm` and `hc machine add` with the stored arguments only for `pdk-tree.connect`; app commands and Herdr's own `menu` |
| pdk-machine-add | `~/.ssh/config` and the files it includes (stock) | as stock: `hc machine ls --json`, `hc machine add <host> --json`, `sh -c` to expand an Include pattern, `uname; command -v herdr-core` on an added machine and, on its Mac card's button, `open` that Mac's Full Disk Access setting there; for an add that needs an answer, `hc machine ls --json`, then `hc run --bg --json --name pdk-add-<random> -- hc machine add <host>` through `exec` with a 20 s limit (a Herdr terminal; what the person types there never reaches the mod), `hc get <name> --json` until it ends, then `hc kill` while live and `hc rm` once finished, each answer checked; Cancel is Herdr's `terminal.kill`; when the dialog goes, for each terminal it started an `sh -c` loop of those same `hc get`/`kill`/`rm` calls (it waits 40 s for one not yet created, 60 s at most) that outlives the dialog, then one more `hc kill`/`hc rm` if that fails; a name still not removed stays in the shared key `pdk.machine.add.owed` and the next dialog tries again; it never removes a machine; `pdk-tree.machine:<name>` |
| pdk-chat | the shown agent's session metadata and transcript, only while the chat is shown (Claude and Codex through one `Feed` per agent, adapters/feed.js over shared/chat-call.js: its `probe` and `tail`, on the agent's own machine; the model and context from the lines read); Codex's model list through the helper's `models codex` (app-server `model/list`) | `pdk-chat.py` for Claude and Codex, one process per call (`probe`: the process's start, Claude's `sessions/<pid>.json`, the names of the files a Codex holds under `~/.codex` and the first line of its held rollouts; `tail`: new whole lines of the one proven session file, waiting up to 10 s for it to grow), on this computer as a file and on another machine as its text given to that machine's own `python3 -I -S -c` through `exec(..., { on })`, where nothing is installed; for a remote agent also `slim` (one over-long session line with its image payloads emptied), `media` and `inline` (a preview of a file or pasted image its session names, made there with that Mac's `sips` or `qlmanage` in a private temp folder that is removed before the answer: the one thing written there) and `piece` (the original of such a file, at most 25 MiB, only after Open or Play is pressed); previews and copies arrive as text in `<home>/pdk-cache/incoming` and the helper's `store` and `keep` move them into `<home>/pdk-cache/media`; the helper (`start`, `held`, `first`, `tty`, `read`, `rows` for the kinds without a Feed; `slim`; `media`, `inline` for tiles, written into `<home>/pdk-cache/media`); `hc send` with `--if`; `hc label <t> herdr.seen=<turn>` (raise only, once per turn, window in front, only for a record that turn wrote, drawn in view) |
| pdk-preview | the file a tile names (regular, non-executable, allow-listed extension) | the helper (`media`, `inline`, `fetch` for a remote image after a click, `open`, `reveal`); the app's `open_url` for Open in browser |
| pdk-factory | live app state; no file | `hc get <t> --json` once per terminal (Core's status time) |
| pdk-tabs, pdk-pane | live app state | app commands |
| pdk-search | live app state; the machine filter | app commands (`space.select`, `tab.select`, `pane.focus`, `terminal.peek`); it moves the machine filter to a pick's machine unless All is on |
| pdk-usage | the helper's masked JSON, one reply per machine; bounded Codex config layers through the shared guard | Every 5 minutes on this computer and on each connected machine (there through `exec(..., { on })`: the same helper and guard, sent as arguments to that machine's `python3 -I -S -c`): `claude auth status --json`, then, unless signed out, Claude's `/usage` as above (on a Mac outside its desktop session, signed out, `launchctl managername`, then both again in a one-off `gui/<uid>` job, then `launchctl bootout`), against that machine's HOME (it can read sessions and change Claude files; it is not side-effect-isolated). Codex account-only app-server RPCs only if the shared TOML guard can disable every configured MCP server, else nothing. When Moshi is installed (`moshi` or `moshi-hook` on PATH), `moshi usage`; only providers with no clean source of their own (Grok) are shown from it. `layout.resize` of its own block |
| pdk-files | directory entry names/types under the originating agent's folder on its machine; no file contents | **Owner-approved exec exception:** only the cloned fixed POSIX `sh -c` directory-listing script, path as an argument, through `exec(..., { on })`; at most 500 entries/folder and 5,000 total. No git, content reads or other exec/hc calls. Attach sends at most 16 paths (4,096 chars/path, 16,384 combined) to the originating draft; no cross-machine copy. |
| pdk-workspace-files, pdk-changes | the captured workspace's folder on its machine: bounded listings, read-only previews, git status and diffs | the cloned stock listing script and `git` read commands in that folder; on a Windows machine (this one, or a remote where `sh` is not found), the stock dialog's fixed PowerShell `Get-ChildItem` listing instead (path as a quoted literal, at most 501 entries, no contents); `pdk-changes` runs `git add -A` and `git commit` there only on an explicit "Commit all changes", after revalidating the repo; never pushes |
| pdk-worktree | the captured repo | Herdr's own worktree commands (stock-derived), with dirty/unpushed re-consent; refuses the main checkout. To find a remote machine's home it runs `sh -c 'printf %s "$HOME"'` there, and `powershell.exe -NoProfile -Command "[Console]::Write($HOME)"` when that fails (Windows), as the stock worktree dialog does |
| pdk-new-menu, pdk-command-form, pdk-guide, pdk-slash | live app state; `pdk-slash` reads custom command and skill NAMES only through the helper's `names` | app commands; `pdk-slash` types a chosen command with `hc keys` into that pane at its prompt, never Enter |

No listing of session folders. `exec` runs only what the table above lists, and nothing else: the fixed stock directory-listing `sh -c` script (pdk-files, pdk-workspace-files; path as an argument), and on Windows pdk-workspace-files' stock PowerShell listing; `git` read commands in each open workspace and in a captured repo, and the explicit commit (pdk-tree, pdk-workspace-files, pdk-changes); Herdr's own worktree commands and the remote home lookup (pdk-worktree); the +'s `test -d` and `printenv HOME` on the chosen machine (pdk-tree); and otherwise `/usr/bin/python3 -I -S` with one of the pack's helpers:
`pdk-helper.py` with one of its fixed commands (`motion start tty held read rows first procs slim media inline
open reveal realpath fetch models names`; `names` lists the NAMES of custom "/" commands and skills, never their contents: `~/.claude/commands`, `~/.claude/skills`, the project's `.claude/commands` and `.claude/skills`, and `$CODEX_HOME/prompts`), and
`pdk-usage.py read <scratch>` (on another machine the same file through that machine's own `python3 -I -S -c`). Its shared `codex_guard.py` parser refuses ambiguous/unreadable config before Codex starts. The pack's own network use is `fetch`: one https image a person clicked to
preview (image types only, at most 25 MB, 20 s, https-only redirects, no cookies or credentials). The usage helper's
commands (Codex's app-server, Claude Code's `/usage`, `moshi usage`) and the chat's guarded `models codex` can reach their
own provider with their own login. `pdk-helper.py` writes only into `<home>/pdk-cache/media` (400 files, 300 MB,
oldest pruned); `pdk-usage.py` writes nothing but runs from `<home>/pdk-state/usage-scratch` (on another machine
`~/.config/herdr-app/pdk-state/usage-scratch`).

## Testing in a sandbox (never the live profile)

- `test/sandbox.sh <short> <cmd>` runs a command against `/tmp/pdk-<short>/`: its own app home (`HERDR_APP_HOME`,
  `HERDR_APP_ID`), a private Core (`HC_SESSION`, `XDG_STATE_HOME`, `XDG_RUNTIME_DIR`, empty `XDG_CONFIG_HOME`, no
  `HC_SOCKET`), a scratch `HOME`, a PATH with only `hc` and `herdr-app`, telemetry off and the updater pointed at a
  dead address. **The scratch HOME is the one development setting**: the pack resolves every agent path from
  `home()`, so fixture copies placed there are found by the production code paths, and nothing of the owner's is.
- `test/scene.sh` builds two workspaces through app commands, with test doubles: `bin/claude` and `bin/codex` in the
  sandbox start `test/fake-agent.py`, a plain program that prints OSC 7501 reports and copies the captured fixtures
  into the scratch HOME (no model, no agent). `test/shots-v3.sh`, `test/shots-sidebar.sh` and `test/shots-themes.sh`
  take the screenshots per theme; `test/shoot.sh` forces a frame (restore and maximize) so shots work with the
  screen locked. `test/qa/` holds qa-modpack's fixture and checks with real Claude, Codex and Hermes sessions.
- `test/dev-sync.sh /tmp/pdk-<short>/home` copies changed files into a running sandbox (sandbox homes only).
- Launching the window from the downloaded bundle with the real HOME would create `~/.local/bin/herdr-app`
  (`src/core_bin/cli_link.rs`); the scratch HOME keeps that link inside the sandbox.

## Evidence kinds (M10) and gaps

Screenshots (S) are the app's own frames (`herdr-app shot`). Most interactions were command dispatch (C:
`herdr-app do`, including the mods' own commands) and the Core calls the UI makes (`hc send`, `hc keys`).
Real pointer and keyboard input (P) ran once, 10:49 to 10:53:36 GMT on 9 November, with the screen unlocked by the
owner and a guard before every event (reports/qa-modpack.md):
- Passed: a tab-bar tab click, a tree tab row click, a tree pane row click focusing that pane, arrow keys and Enter in
  the tree, typing into the composer (not sent), a tab fold-marker click.
- Failed or missed (mostly the script's own aim): workspace row clicks, the Chat toggle, composer Send, factory unit
  and map clicks, the preview dialog's buttons.
- The mods' accessibility labels are not in the macOS AX tree (177 unlabelled elements), so scripted input needs
  geometry. No input was sent after 10:53:36; the owner then switched Accessibility off.

Other gaps: Reduce Motion was not toggled, by the owner's decision. Video plays in the default app from the
preview's poster, which the owner accepted in place of in-app playback. A remote image URL without a file extension
stays a plain link, because finding its type would need a request before the click. Hermes reports no OSC 7501
status, and its blocked state could not be reproduced.

## Limits of the app and Core (reported, not worked around)

- Mods see live state, not Core's history: a unit's time is Core's own status time where `hc get` gives it, else
  "at least since" the board's first look; what was there before that look is history only, never a bubble.
- Core records no sender: relays between agents are not drawn; `<hc from>` messages are marked "unverified sender".
- A mod can't read a tab's split tree or set sizes: reopen restores panes right then down ("approx. layout").
- `run()` returns no ids: reopen waits for the new space, tab or pane to appear in the live lists.
- gpui-shell's native `spin`/`loop` don't consult the system's Reduce Motion: the pack reads it through the helper
  (`defaults read com.apple.universalaccess reduceMotion`) and draws static markers when it is on.
- The window draws only when macOS lets it: with the screen locked, frames come from a forced resize.
- No video element and no remote images in a mod (gpui-kit `typings.rs:2069-2088`; the app sets no HTTP client):
  Play opens the default app, and a remote image is fetched by the helper after a click.
- A mod's `image()` reads only inside the app home, so previews are made into `<home>/pdk-cache/media`.
- A scroll container starts at its top and a mod can move only a virtual list's scroll, so the chat draws the newest
  turns that fit and offers "Show N earlier".
- A mod can't add a section to Herdr's settings (`frame/` is rewritten on every start), so tremor has none of its
  own: the gear opens Herdr's Settings, and themes are picked there.
- Mods get only a local folder picker (`herdr.d.ts:37-39`); the composer's "+" therefore opens pdk-files (a clone of
  Herdr's files tree), which lists through the agent's own machine. The tree reveals the keyboard row with a measured viewport
  (PM G11). Herdr's bundled Geist is one regular face (`src/settings.rs:828`), so the pack uses the system UI
  font on macOS, in every preset including Moshi (design-astra item 1); mono is kept for code, paths, ids, times and
  percentages.
- Approve and Deny from the chat would need a guarded Core command ("press these keys only if this terminal is still
  blocked with this kind, turn, status time and message"); none exists, so the cards are display-only (owner's side,
  hard condition, 9 Nov 23:3x). Adding one is a Core change and the owner's call.
- Typing into a terminal without Enter goes through `hc keys`, which types `/`, letters, digits and `-.=,'` but not
  capitals, `:`, `_`, `?` or `@`: custom "/" names with those are insertable only in the chat.
- macOS only so far (PM G9): Herdr's own Windows/Linux paths are kept in the cloned mods but not tested here.

### Files attach (owner request 27)

The composer + opens pdk-files, Herdr's Apache-2.0 files tree, on the originating agent's machine and starting in its folder; Up goes one level higher, to the root at most. Tick files or folders with Space or the box on each row, open folders with Enter, Right or the caret, Tab to Attach, or Esc to cancel. A ticked folder is attached as its path. Chips show the machine and full-path tooltip, with × to remove. Paths are quoted with the message; selecting/attaching does not read or upload their contents. A changed/cleared origin discards its result.

Sandbox command receipts use `pdk-chat.attach-open`, `pdk-files.pick:<relative path>` (a file or a folder), `pdk-files.fold:<relative folder>`, `pdk-files.parent`, `pdk-files.attach` and `pdk-files.cancel`. These are command dispatch evidence, not physical keyboard proof. The directory-listing exception was tested only in isolated local/box sandboxes.

Program logos: the pinned stock picker draws status glyphs and agent names, not agent logos; the pinned welcome is onboarding without an agent list. The stock new menu, pane/tab headers and program-aware toasts consume the supported program table. Program-table overrides do not rewrite those host renderers. If a shared block was edited after install, uninstall refuses before removing assets and explains what must be restored or removed. Previous Cmd+K-only journal blocks are upgraded/removed too.

Native picture colours are generated with `bun modpack/scripts/program-colours.mjs` (`--check` verifies). Brand colour is kept when it passes every resting ground; otherwise only HSL lightness changes, on a 0.01-point search grid, preserving exact brand hue/saturation before RGB rounding. Grounds include Herdr Paper/Graphite, T3 light/dark and Moshi native menus/sidebar rows. Fixed unbacked pictures cannot reach 3:1 across every selected/hover combination; owner-approved exceptions are listed per mark/state in the manifest. Previous exact text-tinted overlay journals upgrade to the coloured copies, with byte-exact rollback retained.
