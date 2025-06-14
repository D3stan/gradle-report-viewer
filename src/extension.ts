import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// --------- EXTENSION ENTRY POINTS ---------

// Activates the Gradle Report Viewer extension and sets up providers, commands, and UI.
export function activate(context: vscode.ExtensionContext) {
    console.log('Gradle Report Viewer extension is activating.');
    const reportPanels = new Map<string, { panel: vscode.WebviewPanel, watcher: fs.FSWatcher }>();
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showInformationMessage('No workspace folder open.');
        return;
    }
    const workspaceRootUri = workspaceFolders[0].uri;
    const reportsProvider = new GradleReportsProvider(workspaceRootUri, context);
    vscode.window.registerTreeDataProvider('gradleReportView', reportsProvider);
    const filtersProvider = new GradleReportFiltersProvider(workspaceRootUri, context, reportsProvider);
    const filtersTreeView = vscode.window.createTreeView('gradleReportFiltersView', {
        treeDataProvider: filtersProvider
    });
    context.subscriptions.push(filtersTreeView);
    filtersTreeView.onDidChangeCheckboxState(handleCheckboxStateChange);
    registerCommands(context, reportsProvider, filtersProvider, reportPanels);
    ensureDefaultSelections(reportsProvider);
    console.log('Congratulations, your extension "gradle-report-viewer" is now active!');
}

// Deactivates the extension (cleanup if needed).
export function deactivate() {}

// --------- PROVIDER CLASSES ---------

// Provides the Gradle reports tree view, handles filtering and file discovery.
export class GradleReportsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
    private discoveredPublishersCache: string[] | undefined;
    private discoveredExtensionsCache: string[] | undefined;
    constructor(private workspaceRootUri: vscode.Uri | undefined, private context: vscode.ExtensionContext) {
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('gradle-report-viewer.selectedPublishers') ||
                e.affectsConfiguration('gradle-report-viewer.selectedExtensions')) {
                this.refresh();
            }
        });
    }
    // Returns all discovered publishers (subfolders in build/reports)
    async getDiscoveredPublishers(): Promise<string[]> {
        if (!this.workspaceRootUri) { return []; }
        if (this.discoveredPublishersCache) { return this.discoveredPublishersCache; }
        const reportsRootPath = vscode.Uri.joinPath(this.workspaceRootUri, 'build', 'reports');
        try {
            const entries = await vscode.workspace.fs.readDirectory(reportsRootPath);
            this.discoveredPublishersCache = entries
                .filter(([, type]) => type === vscode.FileType.Directory)
                .map(([name]) => name);
            return this.discoveredPublishersCache;
        } catch (error) {
            this.discoveredPublishersCache = [];
            return [];
        }
    }
    // Returns all discovered file extensions (e.g., .html, .xml) in publisher folders
    async getDiscoveredFileExtensions(): Promise<string[]> {
        if (!this.workspaceRootUri) { return []; }
        if (this.discoveredExtensionsCache) { return this.discoveredExtensionsCache; }
        const publishers = await this.getDiscoveredPublishers();
        const allExtensions = new Set<string>();
        for (const publisher of publishers) {
            const publisherPath = vscode.Uri.joinPath(this.workspaceRootUri, 'build', 'reports', publisher);
            try {
                const filesInPublisher = await vscode.workspace.findFiles(new vscode.RelativePattern(publisherPath, '**/*.*'), '**/node_modules/**', 500);
                for (const fileUri of filesInPublisher) {
                    const ext = path.extname(fileUri.fsPath);
                    if (ext && (ext === '.html' || ext === '.xml')) {
                        allExtensions.add(ext);
                    }
                }
            } catch (error) {
                console.warn(`Error scanning extensions in ${publisher}: ${error}`);
            }
        }
        this.discoveredExtensionsCache = Array.from(allExtensions);
        return this.discoveredExtensionsCache;
    }
    // Refreshes the tree view and clears caches
    refresh(): void {
        this.discoveredPublishersCache = undefined;
        this.discoveredExtensionsCache = undefined;
        this._onDidChangeTreeData.fire();
    }
    // Returns the tree item for the given element
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }
    // Returns the children for the given element (or root)
    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if (!this.workspaceRootUri) {
            vscode.window.showInformationMessage('No workspace found for Gradle reports');
            return [];
        }
        const allDiscoveredPublishers = await this.getDiscoveredPublishers();
        const effectiveSelectedPublishers = vscode.workspace.getConfiguration('gradle-report-viewer').get<string[]>('selectedPublishers') || [];
        const allDiscoveredExtensions = await this.getDiscoveredFileExtensions();
        const effectiveSelectedExtensions = vscode.workspace.getConfiguration('gradle-report-viewer').get<string[]>('selectedExtensions') || [];
        if (allDiscoveredPublishers.length === 0 && !element) {
            vscode.window.showInformationMessage('No report subfolders found in build/reports. Please build your project.');
            return [];
        }
        if (element) {
            if (element instanceof PublisherItem) {
                const publisherName = element.label;
                if (!effectiveSelectedPublishers.includes(publisherName)) {
                    return [];
                }
                const publisherPath = vscode.Uri.joinPath(this.workspaceRootUri, 'build', 'reports', publisherName);
                const reportSearchPattern = new vscode.RelativePattern(publisherPath, `**/*{${effectiveSelectedExtensions.join(',')}}`);
                try {
                    const uris = await vscode.workspace.findFiles(reportSearchPattern, '**/node_modules/**', 200);
                    return uris
                        .filter(uri => effectiveSelectedExtensions.includes(path.extname(uri.fsPath)))
                        .map(uri => new ReportItem(
                            path.basename(uri.fsPath),
                            publisherName,
                            uri,
                            vscode.TreeItemCollapsibleState.None,
                            {
                                command: 'gradle-report-viewer.openReport',
                                title: 'Open Report',
                                arguments: [uri]
                            }
                        ));
                } catch (error) {
                    console.error(`Error finding reports for publisher ${publisherName}: ${error}`);
                    return [];
                }
            }
            return [];
        } else {
            return effectiveSelectedPublishers.map(publisher => new PublisherItem(publisher, vscode.TreeItemCollapsibleState.Collapsed));
        }
    }
}

// Provides the filter tree view for publishers and file extensions.
export class GradleReportFiltersProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
    constructor(
        private workspaceRootUri: vscode.Uri | undefined,
        private context: vscode.ExtensionContext,
        private reportsProvider: GradleReportsProvider
    ) {
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('gradle-report-viewer.selectedPublishers') ||
                e.affectsConfiguration('gradle-report-viewer.selectedExtensions')) {
                this.refresh();
            }
        });
    }
    // Refreshes the filter tree view
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }
    // Returns the tree item for the given element
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }
    // Returns the children for the given element (or root)
    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if (!this.workspaceRootUri) { return []; }
        if (!element) {
            return [new FilterCategoryItem('Publishers', 'publishers'), new FilterCategoryItem('File Extensions', 'extensions')];
        }
        if (element instanceof FilterCategoryItem) {
            if (element.filterType === 'publishers') {
                const discoveredPublishers = await this.reportsProvider.getDiscoveredPublishers();
                const selectedPublishers = vscode.workspace.getConfiguration('gradle-report-viewer').get<string[]>('selectedPublishers') || [];
                return discoveredPublishers.map(pub => new FilterEntryItem(pub, 'publisher', selectedPublishers.includes(pub)));
            }
            if (element.filterType === 'extensions') {
                const discoveredExtensions = await this.reportsProvider.getDiscoveredFileExtensions();
                const selectedExtensions = vscode.workspace.getConfiguration('gradle-report-viewer').get<string[]>('selectedExtensions') || [];
                return discoveredExtensions.map(ext => new FilterEntryItem(ext, 'extension', selectedExtensions.includes(ext)));
            }
        }
        return [];
    }
}

// --------- DATA CLASSES ---------

// Represents a publisher folder in the tree view.
class PublisherItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
        this.tooltip = `Reports from ${this.label}`;
        this.iconPath = new vscode.ThemeIcon('folder');
    }
}

// Represents a report file in the tree view.
class ReportItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly description: string,
        public readonly resourceUri: vscode.Uri,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command
    ) {
        super(label, collapsibleState);
        this.tooltip = `${this.label} - ${this.description}`;
        this.iconPath = new vscode.ThemeIcon('file-code');
    }
}

// Represents a filter category (publishers or extensions) in the filter tree view.
class FilterCategoryItem extends vscode.TreeItem {
    constructor(public readonly label: string, public readonly filterType: 'publishers' | 'extensions') {
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.iconPath = new vscode.ThemeIcon('filter');
    }
}

// Represents a filter entry (publisher or extension) in the filter tree view.
class FilterEntryItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly entryType: 'publisher' | 'extension',
        public readonly isChecked: boolean
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.checkboxState = isChecked ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;
        this.command = {
            title: isChecked ? 'Deselect' : 'Select',
            command: entryType === 'publisher' ? 'gradle-report-viewer.togglePublisherSelection' : 'gradle-report-viewer.toggleExtensionSelection',
            arguments: [this.label]
        };
        this.iconPath = entryType === 'publisher' ? new vscode.ThemeIcon('symbol-folder') : new vscode.ThemeIcon('symbol-file');
    }
}

// --------- UTILITY & HELPER FUNCTIONS ---------

// Updates the webview panel with the content of the report file, injecting styles and reload button.
function updateWebviewContent(panel: vscode.WebviewPanel, reportPath: string) {
    try {
        console.log(`Updating webview for: ${reportPath}`);
        const data = fs.readFileSync(reportPath, 'utf8');
        let webviewContent = data.replace(/(href|src)=["'](?!http|data:)([^"']+)["']/g, (match, attr, filePath) => {
            const onDiskPath = vscode.Uri.file(path.resolve(path.dirname(reportPath), filePath));
            const webviewUri = panel.webview.asWebviewUri(onDiskPath);
            return `${attr}="${webviewUri}"`;
        });
        const style = `
<style>
    body {
        background-color: white;
        color: black;
    }
    body a {
        color: #0000EE;
    }
    .reload-button {
        position: fixed;
        top: 10px;
        right: 10px;
        padding: 8px 12px;
        background-color: #007ACC;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        z-index: 1000;
    }
    .reload-button:hover {
        background-color: #005f9e;
    }
</style>`;
        const script = `
<script>
    const vscode = acquireVsCodeApi();
    function reloadReport() {
        vscode.postMessage({
            command: 'reload'
        });
    }
</script>`;
        const reloadButton = `<button class="reload-button" onclick="reloadReport()">Reload</button>`;
        if (/<head[^>]*>/i.test(webviewContent)) {
            webviewContent = webviewContent.replace(/<head[^>]*>/i, `$&${style}${script}`);
        } else {
            webviewContent = style + script + webviewContent;
        }
        if (/<body/i.test(webviewContent)) {
            webviewContent = webviewContent.replace(/<body([^>]*)>/i, `<body$1>${reloadButton}`);
        } else {
            webviewContent += reloadButton;
        }
        console.log('Setting webview HTML content.');
        panel.webview.html = webviewContent;
    } catch (err: any) {
        console.error(`Error reading report file: ${err.message}`);
        panel.webview.html = `<body>Error loading report: ${err.message}. It may have been removed.</body>`;
        vscode.window.showErrorMessage(`Error reading report file: ${err.message}`);
    }
}

// Handles checkbox state changes in the filter tree view.
function handleCheckboxStateChange(e: any) {
    for (const [treeItem] of e.items) {
        const item = treeItem as FilterEntryItem | undefined as any;
        if (!item || typeof item.entryType !== 'string') {
            continue;
        }
        const label = item.label as string;
        if (item.entryType === 'publisher') {
            vscode.commands.executeCommand('gradle-report-viewer.togglePublisherSelection', label);
        } else if (item.entryType === 'extension') {
            vscode.commands.executeCommand('gradle-report-viewer.toggleExtensionSelection', label);
        }
    }
}

// Registers all extension commands (open report, toggle filters, etc).
function registerCommands(context: vscode.ExtensionContext, reportsProvider: GradleReportsProvider, filtersProvider: GradleReportFiltersProvider, reportPanels: Map<string, { panel: vscode.WebviewPanel, watcher: fs.FSWatcher }>) {
    context.subscriptions.push(vscode.commands.registerCommand('gradle-report-viewer.showReports', () => {
        reportsProvider.refresh();
        filtersProvider.refresh();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('gradle-report-viewer.openReport', (uriOrItem: vscode.Uri | ReportItem) => {
        let reportUri: vscode.Uri | undefined;
        if (uriOrItem instanceof vscode.Uri) {
            reportUri = uriOrItem;
            console.log('openReport command triggered with URI:', reportUri.fsPath);
        } else if (uriOrItem instanceof ReportItem && uriOrItem.resourceUri) {
            reportUri = uriOrItem.resourceUri;
            console.log('openReport command triggered with ReportItem:', reportUri.fsPath);
        }
        if (!reportUri) {
            console.warn('openReport called with an invalid or unexpected item:', uriOrItem);
            return;
        }
        const reportPath = reportUri.fsPath;
        const existingPanelInfo = reportPanels.get(reportPath);
        if (existingPanelInfo) {
            console.log('Found existing panel for this report. Revealing it.');
            existingPanelInfo.panel.reveal();
            return;
        }
        console.log('No existing panel found. Creating a new one for:', reportPath);
        const panel = vscode.window.createWebviewPanel(
            'gradleReport',
            `Report: ${path.basename(reportPath)}`,
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.file(path.dirname(reportPath))],
                retainContextWhenHidden: true
            }
        );
        updateWebviewContent(panel, reportPath);
        const watcher = fs.watch(reportPath, (event, filename) => {
            if (event === 'change') {
                console.log(`Report file ${reportPath} changed, reloading.`);
                updateWebviewContent(panel, reportPath);
            }
        });
        panel.webview.onDidReceiveMessage(
            message => {
                if (message.command === 'reload') {
                    console.log('Reload message received from webview.');
                    updateWebviewContent(panel, reportPath);
                }
            },
            undefined,
            context.subscriptions
        );
        reportPanels.set(reportPath, { panel, watcher });
        panel.onDidDispose(
            () => {
                console.log(`Panel for ${reportPath} was disposed.`);
                const panelInfo = reportPanels.get(reportPath);
                if (panelInfo) {
                    panelInfo.watcher.close();
                    reportPanels.delete(reportPath);
                }
            },
            null,
            context.subscriptions
        );
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
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('gradle-report-viewer.togglePublisherSelection', async (publisherName: string) => {
        const config = vscode.workspace.getConfiguration('gradle-report-viewer');
        let selectedPublishers = config.get<string[]>('selectedPublishers') || [];
        const allDiscovered = await reportsProvider.getDiscoveredPublishers();
        const index = selectedPublishers.indexOf(publisherName);
        if (index > -1) {
            selectedPublishers.splice(index, 1);
        } else {
            selectedPublishers.push(publisherName);
        }
        await config.update('selectedPublishers', selectedPublishers, vscode.ConfigurationTarget.Global);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('gradle-report-viewer.toggleExtensionSelection', async (extension: string) => {
        const config = vscode.workspace.getConfiguration('gradle-report-viewer');
        let selectedExtensions = config.get<string[]>('selectedExtensions') || [];
        const allDiscoveredExts = await reportsProvider.getDiscoveredFileExtensions();
        const index = selectedExtensions.indexOf(extension);
        if (index > -1) {
            selectedExtensions.splice(index, 1);
        } else {
            selectedExtensions.push(extension);
        }
        await config.update('selectedExtensions', selectedExtensions, vscode.ConfigurationTarget.Global);
    }));
}

// Ensures that default selections are set for publishers and extensions if config is empty.
function ensureDefaultSelections(reportsProvider: GradleReportsProvider) {
    (async () => {
        const cfg = vscode.workspace.getConfiguration('gradle-report-viewer');
        if ((cfg.get<string[]>('selectedPublishers') || []).length === 0) {
            const pubs = await reportsProvider.getDiscoveredPublishers();
            if (pubs.length) {
                await cfg.update('selectedPublishers', pubs, vscode.ConfigurationTarget.Global);
            }
        }
        if ((cfg.get<string[]>('selectedExtensions') || []).length === 0) {
            const exts = await reportsProvider.getDiscoveredFileExtensions();
            if (exts.length) {
                await cfg.update('selectedExtensions', exts, vscode.ConfigurationTarget.Global);
            }
        }
    })();
}
