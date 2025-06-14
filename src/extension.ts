// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showInformationMessage('No workspace folder open.');
        return;
    }
    // For simplicity, using the first workspace folder. Multi-root workspaces might need more handling.
    const workspaceRootUri = workspaceFolders[0].uri;
    const reportsProvider = new GradleReportsProvider(workspaceRootUri, context);
    vscode.window.registerTreeDataProvider('gradleReportView', reportsProvider);

    context.subscriptions.push(vscode.commands.registerCommand('gradle-report-viewer.showReports', () => {
        reportsProvider.refresh();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('gradle-report-viewer.openReport', (item: ReportItem | PublisherItem) => {
        if (item instanceof ReportItem && item.resourceUri) {
            const reportPath = item.resourceUri.fsPath;
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
                const webviewContent = data.replace(/(href|src)=["'](?!http|data:)([^"']+)["']/g, (match, attr, filePath) => {
                    const onDiskPath = vscode.Uri.file(path.resolve(path.dirname(reportPath), filePath));
                    const webviewUri = panel.webview.asWebviewUri(onDiskPath);
                    return `${attr}="${webviewUri}"`;
                });
                panel.webview.html = webviewContent;
            });
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('gradle-report-viewer.selectPublishers', async () => {
        const discoveredPublishers = await reportsProvider.getDiscoveredPublishers();
        if (discoveredPublishers.length === 0) {
            vscode.window.showInformationMessage('No report publishers found in build/reports.');
            return;
        }

        const currentSelectedPublishers = vscode.workspace.getConfiguration('gradle-report-viewer').get<string[]>('selectedPublishers') || discoveredPublishers;

        const picks = discoveredPublishers.map(publisher => ({
            label: publisher,
            picked: currentSelectedPublishers.includes(publisher)
        }));

        const result = await vscode.window.showQuickPick(picks, {
            canPickMany: true,
            placeHolder: 'Select report publishers (subfolders in build/reports) to display'
        });

        if (result) {
            const newSelectedPublishers = result.map(pick => pick.label);
            await vscode.workspace.getConfiguration('gradle-report-viewer').update('selectedPublishers', newSelectedPublishers, vscode.ConfigurationTarget.Global);
            // No need to call reportsProvider.refresh() here as it's handled by onDidChangeConfiguration
        }
    }));

    console.log('Congratulations, your extension "gradle-report-viewer" is now active!');
}

export class GradleReportsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {

    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
    private discoveredPublishersCache: string[] | undefined;

    constructor(private workspaceRootUri: vscode.Uri | undefined, private context: vscode.ExtensionContext) {
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('gradle-report-viewer.selectedPublishers')) {
                this.refresh();
            }
        });
    }

    async getDiscoveredPublishers(): Promise<string[]> {
        if (!this.workspaceRootUri) {
            return [];
        }
        if (this.discoveredPublishersCache) {
            // Return cached value if available to avoid frequent disk access
            // Cache will be cleared on refresh()
        }

        const reportsRootPath = vscode.Uri.joinPath(this.workspaceRootUri, 'build', 'reports');
        try {
            const entries = await vscode.workspace.fs.readDirectory(reportsRootPath);
            const publishers = entries
                .filter(([name, type]) => type === vscode.FileType.Directory)
                .map(([name, type]) => name);
            this.discoveredPublishersCache = publishers;
            return publishers;
        } catch (error) {
            // build/reports might not exist, which is fine
            console.log(`Error reading build/reports directory: ${error}`);
            this.discoveredPublishersCache = [];
            return [];
        }
    }

    refresh(): void {
        this.discoveredPublishersCache = undefined; // Clear cache on refresh
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if (!this.workspaceRootUri) {
            vscode.window.showInformationMessage('No workspace found for Gradle reports');
            return [];
        }

        const allDiscoveredPublishers = await this.getDiscoveredPublishers();
        if (allDiscoveredPublishers.length === 0 && !element) {
             // Only show message if it's the root and no publishers found
            vscode.window.showInformationMessage('No report subfolders found in build/reports. Please build your project.');
            return [];
        }

        let selectedPublishers = vscode.workspace.getConfiguration('gradle-report-viewer').get<string[]>('selectedPublishers');
        // If nothing is configured, default to all discovered publishers
        if (!selectedPublishers || selectedPublishers.length === 0) {
            selectedPublishers = allDiscoveredPublishers;
        }

        if (element) {
            if (element instanceof PublisherItem) {
                const publisherName = element.label;
                // Search for HTML and XML files directly within the publisher's subfolder
                const reportSearchPattern = new vscode.RelativePattern(
                    vscode.Uri.joinPath(this.workspaceRootUri, 'build', 'reports', publisherName),
                    '**/*.{html,xml}'
                );

                try {
                    const uris = await vscode.workspace.findFiles(reportSearchPattern, '**/node_modules/**', 200);
                    return uris.map(uri => new ReportItem(
                        path.basename(uri.fsPath),
                        publisherName, // The publisher is the description
                        uri,
                        vscode.TreeItemCollapsibleState.None,
                        {
                            command: 'gradle-report-viewer.openReport',
                            title: 'Open Report',
                            arguments: [new ReportItem(path.basename(uri.fsPath), publisherName, uri, vscode.TreeItemCollapsibleState.None)] // Pass ReportItem
                        }
                    ));
                } catch (error) {
                    console.error(`Error finding reports for publisher ${publisherName}: ${error}`);
                    return [];
                }
            }
            return []; // ReportItems have no children
        } else {
            // Root level: list selected publishers from the discovered ones
            const publishersToShow = allDiscoveredPublishers.filter(p => selectedPublishers!.includes(p));
            return publishersToShow.map(publisher => new PublisherItem(publisher, vscode.TreeItemCollapsibleState.Collapsed));
        }
    }

    // getReportType might be simplified or removed if publisher folder is the sole source of truth for type
    // For now, it can be kept if ReportItem.description needs more specific info than just folder name.
    private getReportType(filePath: string): string { // This is now more of a descriptor
        const pathSegments = filePath.split(path.sep);
        // Try to get the publisher name from the path, e.g., build/reports/pmd/main.html -> pmd
        const reportsIndex = pathSegments.indexOf('reports');
        if (reportsIndex !== -1 && reportsIndex + 1 < pathSegments.length) {
            const publisherFolder = pathSegments[reportsIndex + 1];
            // Simple capitalization for display
            return publisherFolder.charAt(0).toUpperCase() + publisherFolder.slice(1);
        }
        if (filePath.endsWith('.xml')) return 'XML Report';
        return 'HTML Report';
    }
}

class PublisherItem extends vscode.TreeItem {
    constructor(
        public readonly label: string, // Publisher name
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
        this.tooltip = `Reports from ${this.label}`;
        this.iconPath = new vscode.ThemeIcon('folder'); // Use folder icon for publishers
    }
}

class ReportItem extends vscode.TreeItem {
    constructor(
        public readonly label: string, // File name
        public readonly description: string, // Publisher type (folder name)
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
