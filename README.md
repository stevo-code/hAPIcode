<div align="center">

<img src="assets/banner.png" alt="hAPIcode" width="560">

**A multi-provider desktop coding agent — bring your own API key.**

An Electron app inspired by Claude Code, with two sections — **Chat** and **Code** —
where **you choose the provider and the model**: OpenAI / ChatGPT, Anthropic / Claude, Google Gemini,
DeepSeek, OpenRouter, Groq, Mistral, xAI, or any **OpenAI-compatible** endpoint.

</div>

Each user enters their **own** API keys. They are stored **locally and encrypted**
(system keychain via Electron's `safeStorage`) — **never** sent to a third-party server.

## ✨ Features

- 🔑 **Settings** — multiple API keys, shown masked (`sk-12****cdef`), with a "Test" button.
- 🤖 **Live models** — the model list is fetched from each key's own API.
- 🧠 **Reasoning levels** — Low → Max + **Ultracode** mode (parallel sub-agents).
- 💬 **Chat** — streaming conversation with any configured model.
- ⌨️ **Code** — an agent that reads, writes and runs commands, on a **local folder** or an **SSH machine**.
- ✅ **Action approval** — clear step-by-step flow (narration → command → result).
- 🖥️ **Always-on SSH** — keepalive, auto-reconnect, saved hosts (encrypted secrets).
- 🗂️ **Background tasks** — track running commands and sub-agents.
- 📏 **Real context gauge** — actual API tokens + **automatic compaction**.
- 🪟 **Windows integration** — custom title bar, close-to-tray, start with the system.
- 🌐 **Bilingual** — EN / FR.

## 🚀 Install

Grab the latest build from the **[Releases](../../releases)** page, then add at least one API key in Settings.

- **Windows** — download `hAPIcode-<version>-x64.exe` and run the installer.
- **Linux** — download the `.AppImage` (`chmod +x hAPIcode-*.AppImage` then run it) or the `.deb` (`sudo dpkg -i hAPIcode-*.deb`).

> Primarily designed for Windows; it also runs on Linux, though some integrations (start-with-system, tray) are tuned for Windows. A macOS build is planned (it has to be built on a Mac / macOS CI runner).

## 🛠️ Development

```bash
npm install
npm run dev        # development mode (hot reload)
npm run typecheck  # TypeScript type checking
npm run build      # build the bundles (main / preload / renderer)
```

## 📦 Build the installers

```bash
npm run build:win    # -> dist/hAPIcode-<version>-x64.exe
npm run build:linux  # -> dist/hAPIcode-<version>-x86_64.AppImage  +  -amd64.deb
```

> Linux builds run **natively**; the Windows `.exe` is built on Linux **via Wine**. A macOS build requires a Mac (or a macOS CI runner) — it can't be produced from Linux.

## 🧱 Stack

Electron · React 18 · TypeScript · electron-vite · electron-builder.
Providers implemented with plain `fetch` (no SDK); SSH via `ssh2`; Markdown rendering via `react-markdown`.

## 🔒 Privacy

API keys and conversations stay on your machine (`%AppData%/hAPIcode`). The source code contains no keys.
