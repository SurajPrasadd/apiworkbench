# API Workbench

A local API client and development workbench built directly into Visual Studio Code.

**Everything stays local: collections, environments, history, and saved responses never leave your machine.**

## How to Use

### Open the Workbench in VS Code

1. Open the Command Palette:

   * Windows/Linux: `Ctrl + Shift + P`
   * macOS: `Cmd + Shift + P`
2. Search for **API Workbench: Open**.
3. Select it to open API Workbench in a new tab.

### Download for Windows

API Workbench is also available as a standalone Windows application.

* **Download size:** Approximately 10–15 MB
* **Postman comparison:** Postman typically requires significantly more disk space.
* **Installer:** [Download API Workbench for Windows](https://github.com/SurajPrasadd/api-workbench-tauri/raw/refs/heads/main/bundle/msi/API%20Workbench_1.0.0_x64_en-US.msi)

> **Note:** The Windows application is currently **unsigned**, so Microsoft Defender SmartScreen may display the following message:
>
> **"Microsoft Defender SmartScreen prevented an unrecognized app from starting."**
>
> If you downloaded the installer from the official GitHub repository and trust the source, click:
>
> **More info → Run anyway**

## Key Features

* 🚀 Send API requests using **GET, POST, PUT, PATCH, and DELETE**
* 📁 Organize requests with **collections and folders**
* 🌎 Use environments and variables such as `{{baseUrl}}` and `{{accessToken}}`
* 🔐 Write **pre-request scripts** using JavaScript with CryptoJS / AES support
* 🧪 Run **post-response scripts** for validation and token handling
* 🔑 Manage **access and refresh tokens**
* 📜 View **request history**
* 💾 Save API responses for later use
* 📤 **Import and export** collections and environments with Postman-compatible formats
* 🏠 Store everything **locally on your machine**

## Privacy

Everything runs locally inside the VS Code WebView, extension host, or standalone application.

**No backend or external API is required. Your collections, environments, history, and saved responses stay on your machine.**

## Screenshot

<img src="images/screenshot.png" alt="API Workbench screenshot" width="600">

## License

MIT