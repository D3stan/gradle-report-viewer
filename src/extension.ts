// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    const reportsProvider = new GradleReportsProvider(vscode.workspace.rootPath);
    vscode.window.registerTreeDataProvider('gradleReportView', reportsProvider);

    vscode.commands.registerCommand('gradle-report-viewer.showReports', () => {
        // This command is now implicitly handled by the tree view
        // but can be used to refresh the view if needed.
        reportsProvider.refresh();
    });

    vscode.commands.registerCommand('gradle-report-viewer.openReport', (reportUri: vscode.Uri) => {
        const reportPath = reportUri.fsPath;
        const panel = vscode.window.createWebviewPanel(
            'gradleReport',
            `Report: ${path.basename(reportPath)}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.file(path.dirname(reportPath))]
            }
        );

        fs.readFile(reportPath, 'utf8', (err, data) => {
            if (err) {
                vscode.window.showErrorMessage(`Error reading report file: ${err.message}`);
                return;
            }
            // Resolve local resources like CSS and JS files
            const webviewContent = data.replace(/(href|src)=["'](?!http|data:)([^"']+)["']/g, (match, attr, filePath) => {
                const onDiskPath = vscode.Uri.file(path.resolve(path.dirname(reportPath), filePath));
                const webviewUri = panel.webview.asWebviewUri(onDiskPath);
                return `${attr}="${webviewUri}"`;
            });
            panel.webview.html = webviewContent;
        });
    });

    console.log('Congratulations, your extension "gradle-report-viewer" is now active!');
}

export class GradleReportsProvider implements vscode.TreeDataProvider<ReportItem> {

    private _onDidChangeTreeData: vscode.EventEmitter<ReportItem | undefined | null | void> = new vscode.EventEmitter<ReportItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ReportItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private workspaceRoot: string | undefined) { }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ReportItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ReportItem): Thenable<ReportItem[]> {
        if (!this.workspaceRoot) {
            vscode.window.showInformationMessage('No workspace found for Gradle reports');
            return Promise.resolve([]);
        }

        if (element) {
            // We are not expecting any children for report items
            return Promise.resolve([]);
        } else {
            // Root level, list all .html and .xml files in typical Gradle report locations
            const reportPattern = '**/build/reports/**/*.{html,xml}';
            return vscode.workspace.findFiles(reportPattern, '**/node_modules/**', 100)
                .then(uris => {
                    return uris.map(uri => {
                        const reportType = this.getReportType(uri.fsPath);
                        return new ReportItem(
                            path.basename(uri.fsPath),
                            reportType,
                            uri, // Use vscode.Uri directly
                            vscode.TreeItemCollapsibleState.None,
                            {
                                command: 'gradle-report-viewer.openReport',
                                title: 'Open Report',
                                arguments: [uri] // Pass vscode.Uri as argument
                            }
                        );
                    });
                });
        }
    }

    private getReportType(filePath: string): string {
        if (filePath.includes('checkstyle')) return 'Checkstyle';
        if (filePath.includes('pmd')) return 'PMD';
        if (filePath.includes('spotbugs') || filePath.includes('findbugs')) return 'SpotBugs/FindBugs';
        if (filePath.includes('jacoco')) return 'JaCoCo';
        if (filePath.includes('tests')) return 'Test Results';
        if (filePath.endsWith('.xml')) return 'XML Report';
        return 'HTML Report';
    }
}

class ReportItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly description: string, // Used as report type here
        public readonly resourceUri: vscode.Uri, // Changed to vscode.Uri
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command
    ) {
        super(label, collapsibleState);
        this.tooltip = `${this.label} - ${this.description}`;
        // Ensure icon paths are correct relative to the extension's install directory
        // Using vscode.Uri.file for absolute paths or vscode.Uri.joinPath for relative paths from context.extensionUri
        // For simplicity, using a codicon for now, replace with actual file paths if needed.
        this.iconPath = new vscode.ThemeIcon('file-code'); // Using a built-in codicon
    }
}

// This method is called when your extension is deactivated
export function deactivate() {}
