import * as vscode from 'vscode';
import axios from 'axios';

export function activate(context: vscode.ExtensionContext) {
  console.log('Code Fix Extension is now active!');

  let timeout: NodeJS.Timeout | undefined = undefined;
  let lastSentCode: string | undefined = undefined;
  let decorationType: vscode.TextEditorDecorationType | undefined = undefined;
  let fixedEditor: vscode.TextEditor | undefined = undefined;
  let saveButton: vscode.StatusBarItem | undefined = undefined;
  let cancelButton: vscode.StatusBarItem | undefined = undefined;

  // Store the current vulnerable lines and hover messages
  let vulnerableRanges: vscode.DecorationOptions[] = [];

  // Helper to clear decorations and buttons
  function clearDecorationsAndButtons() {
    if (decorationType) {
      vscode.window.visibleTextEditors.forEach(editor => {
        editor.setDecorations(decorationType!, []);
      });
      decorationType.dispose();
      decorationType = undefined;
    }
    if (saveButton) {
      saveButton.dispose();
      saveButton = undefined;
    }
    if (cancelButton) {
      cancelButton.dispose();
      cancelButton = undefined;
    }
    vulnerableRanges = [];
  }

  // Helper to create decoration type for vulnerable lines
  function createDecorationType() {
    return vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: 'rgba(255,0,0,0.3)',
      overviewRulerColor: 'red',
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      light: {
        backgroundColor: 'rgba(255,0,0,0.3)'
      },
      dark: {
        backgroundColor: 'rgba(255,0,0,0.3)'
      }
    });
  }

  // Helper to send code to backend
  async function sendCodeToBackend(code: string): Promise<any> {
    try {
      const response = await axios.post('http://localhost:8000/analyze', { code });
      return response.data;
    } catch (error: unknown) {
      let message = 'Unknown error';
      if (error instanceof Error) {
        message = error.message;
      }
      vscode.window.showErrorMessage('Failed to send code to backend: ' + message);
      return null;
    }
  }

  // Helper to create or update fixed file editor
  async function showFixedFile(originalUri: vscode.Uri, fixedCode: string) {
    const originalFileName = originalUri.path.split('/').pop() || 'file';
    const fixedFileName = originalFileName + '-fixed';

    // Create a new untitled document with fixed code
    const associations = vscode.workspace.getConfiguration('files').get<Record<string, string>>('associations');
    const extension = originalFileName.split('.').pop() || '';
    const language = associations?.[extension] || undefined;
    const fixedDoc = await vscode.workspace.openTextDocument({
      content: fixedCode,
      language
    });

    fixedEditor = await vscode.window.showTextDocument(fixedDoc, vscode.ViewColumn.Beside, true);

    // Show save and cancel buttons
    saveButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    saveButton.text = '$(check) Save';
    saveButton.command = 'codeFixExtension.saveFix';
    saveButton.show();

    cancelButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    cancelButton.text = '$(x) Cancel';
    cancelButton.command = 'codeFixExtension.cancelFix';
    cancelButton.show();
  }

  // Helper to apply decorations for vulnerabilities
  function applyVulnerabilityDecorations(editor: vscode.TextEditor, vulnerableLine: number, hoverMessage: string) {
    if (decorationType) {
      decorationType.dispose();
    }
    decorationType = createDecorationType();

    const range = new vscode.Range(vulnerableLine - 1, 0, vulnerableLine - 1, editor.document.lineAt(vulnerableLine - 1).text.length);
    vulnerableRanges = [{ range, hoverMessage: new vscode.MarkdownString(hoverMessage) }];

    editor.setDecorations(decorationType, vulnerableRanges);
  }

  // Helper to replace vulnerable lines with fixed lines
  function getFixedCode(originalCode: string, vulnerableLine: number | null, suggestedFix: string | null): string {
    if (vulnerableLine === null || !suggestedFix) {
      return originalCode;
    }
    const lines = originalCode.split(/\r?\n/);
    // Replace the vulnerable line with suggested fix
    lines[vulnerableLine - 1] = suggestedFix;
    return lines.join('\n');
  }

  // Listen to document changes with debounce
  vscode.workspace.onDidChangeTextDocument(event => {
    if (timeout) {
      clearTimeout(timeout);
    }

    // Only send if document is dirty (edited)
    if (!event.document.isDirty) {
      return;
    }

    // Check if content really changed (avoid slight background formatting)
    const currentCode = event.document.getText();
    if (lastSentCode === currentCode) {
      return;
    }

    timeout = global.setTimeout(async () => {
      lastSentCode = currentCode;

      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.uri.toString() !== event.document.uri.toString()) {
        return;
      }

      const response = await sendCodeToBackend(currentCode);
      if (!response) {
        clearDecorationsAndButtons();
        return;
      }

      if (response.status === 'vulnerabilities found' && response.vulnerable_line !== null) {
        applyVulnerabilityDecorations(editor, response.vulnerable_line, response.report);

        const fixedCode = getFixedCode(currentCode, response.vulnerable_line, response.suggested_fix);
        await showFixedFile(event.document.uri, fixedCode);

        // Register commands for save and cancel
        context.subscriptions.push(vscode.commands.registerCommand('codeFixExtension.saveFix', async () => {
          if (!fixedEditor) {
            return;
          }
          const fixedDoc = fixedEditor.document;
          const originalDoc = editor.document;

          // Save fixed code to original file
          const edit = new vscode.WorkspaceEdit();
          const fullRange = new vscode.Range(
            originalDoc.positionAt(0),
            originalDoc.positionAt(originalDoc.getText().length)
          );
          edit.replace(originalDoc.uri, fullRange, fixedDoc.getText());
          await vscode.workspace.applyEdit(edit);
          await originalDoc.save();

          // Close fixed editor without saving
          if (fixedEditor) {
            await vscode.window.showTextDocument(fixedEditor.document);
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
          }

          clearDecorationsAndButtons();
        }));

        context.subscriptions.push(vscode.commands.registerCommand('codeFixExtension.cancelFix', async () => {
          // Close fixed editor without saving
          if (fixedEditor) {
            await vscode.window.showTextDocument(fixedEditor.document);
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
          }
          clearDecorationsAndButtons();
        }));

      } else {
        clearDecorationsAndButtons();
        vscode.window.showInformationMessage('No vulnerabilities found.');
      }
    }, 2000);
  });
}

export function deactivate() {
  // Clean up if needed
}