# Gradle Report Viewer for VS Code

**Gradle Report Viewer** is a Visual Studio Code extension designed to help developers inspect various reports generated by Gradle builds (such as Checkstyle, PMD, SpotBugs/FindBugs, JaCoCo, and test results) directly within the editor. This eliminates the need to open these reports in an external web browser, streamlining the development workflow.

![Demo](./media/gradle-report-viewer.gif)

## Installation

There are two ways to install the Gradle Report Viewer extension:

1.  **From a VSIX file**: Download the pre-packaged extension from the [GitHub Releases page](https://github.com/D3stan/gradle-report-viewer/releases) for the easiest installation.
2.  **From source**: Clone the repository and build the extension yourself.

---

## Download and Install from GitHub Releases

1.  **Go to the Releases page**: Navigate to the [releases section](https://github.com/D3stan/gradle-report-viewer/releases) of the repository.
2.  **Download the `.vsix` file**: Find the latest release and download the `.vsix` file from the "Assets" section.
3.  **Install in VS Code**:
    *   Open Visual Studio Code.
    *   Go to the **Extensions** view (`Ctrl+Shift+X`).
    *   Click the **...** (More Actions) button in the view's header.
    *   Select **Install from VSIX...** and choose the `.vsix` file you downloaded.

---

## Build and Install from Source

To compile and package the extension from the source code, follow these steps:

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/D3stan/gradle-report-viewer.git
    cd gradle-report-viewer
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Package the extension**:
    ```bash
    npm run package
    ```
    This will create a `.vsix` file in the root of the project (e.g., `gradle-report-viewer-0.1.3.vsix`).

4.  **Install the extension in VS Code**:
    *   Open VS Code.
    *   Go to the Extensions view (Ctrl+Shift+X).
    *   Click on the `...` (More Actions) menu in the top-right corner of the Extensions view.
    *   Select "Install from VSIX..." and choose the `.vsix` file you just created.

5.  **Alternatively, run in development mode**:
    *   Open the project folder in VS Code.
    *   Press `F5` to open a new Extension Development Host window with the extension running.

## Features

*   **Integrated Report Viewing**: Opens HTML and XML reports in a dedicated webview panel inside VS Code.
*   **Activity Bar Icon**: Provides a convenient entry point through a dedicated icon in the activity bar.
*   **Report Discovery**: Automatically scans your workspace for common Gradle report locations (typically under `build/reports/`).
*   **Tree View for Reports**: Lists all detected reports in an accessible tree view, categorized by type where possible (e.g., Checkstyle, PMD).
*   **Local Resource Resolution**: Ensures that reports with local CSS and JavaScript dependencies render correctly within the VS Code webview.

## Usage

1.  **Open your Gradle Project**: Ensure you have a Gradle project open in your VS Code workspace.
2.  **Generate Reports**: Run your Gradle build tasks that generate the desired reports (e.g., `gradle check`, `gradle test`, `gradle build`).
3.  **Access the Viewer**:
    *   Look for the "Gradle Reports" icon in the VS Code Activity Bar (usually on the left-hand side).
    *   Click the icon to open the "Available Reports" view.
4.  **Browse and Open Reports**:
    *   The view will list all HTML and XML files found in your project's `build/reports` directories.
    *   Click on any report in the list to open it in a new editor tab.
5.  **Refresh Reports**:
    *   If you regenerate reports, you can refresh the list by clicking the refresh icon in the "Available Reports" view header or by running the "Gradle Report Viewer: Show Gradle Reports" command from the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`).

## Supported Reports

The extension is designed to work with HTML and XML files typically found in Gradle report directories. This includes, but is not limited to, reports generated by:

*   Checkstyle
*   PMD
*   SpotBugs / FindBugs
*   JaCoCo (Code Coverage)
*   JUnit/TestNG (Test Results)
*   Other custom Gradle tasks that output HTML/XML reports.

## Requirements

*   Visual Studio Code version 1.101.0 or higher.
*   A Java project managed with Gradle that generates HTML or XML reports.

## Extension Settings

This extension does not currently contribute any specific VS Code settings.

## Known Issues

*   Complex JavaScript interactions within some HTML reports might not behave identically to a full browser environment, though common cases are handled.
*   Very large reports might take a moment to load and render.

If you encounter any issues, please report them on the issue section.


## Contributing

Contributions, issues, and feature requests are welcome.

## For more information

[Visual Studio Code Extension Development](https://code.visualstudio.com/api)

**Enjoy a more integrated Gradle workflow!**
