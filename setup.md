# Build, Run, Package, and Install

## Build and Run

> **Important:** Use a fresh, empty folder before starting.

Run the following commands:

```bash
npm install
npm run compile
```

### Launch the Extension

1. Open the project in **Visual Studio Code**.
2. Press **F5** to launch the Extension Development Host.
3. In the new VS Code window, press **Ctrl+Shift+P**.
4. Search for and run:

```text
API Workbench: Open
```

---

## Package and Install

Create the VS Code extension package:

```bash
npx @vscode/vsce package --allow-missing-repository
```

This generates the `.vsix` package, for example:

```text
api-workbench-1.0.0.vsix
```

Install the generated extension:

```bash
code --install-extension api-workbench-1.0.0.vsix
```

After installation, restart or reload VS Code if required.
