import { Diagnostic, TextEdit } from 'vscode-languageserver';
import { LangiumDocument } from 'langium';
import { SafeDsServices } from '../../safe-ds-module.js';
import { isSdsCall,isSdsCallable, isSdsAnnotationCall, isSdsAnnotationCallList } from '../../generated/ast.js';
import { CodeActionAcceptor } from '../safe-ds-code-action-provider.js';
import { createQuickfixFromTextEditsToSingleDocument } from '../factories.js';

export const removeUnnecessaryArgumentList = (services: SafeDsServices) => {
    const locator = services.workspace.AstNodeLocator;

    return (diagnostic: Diagnostic, document: LangiumDocument, acceptor: CodeActionAcceptor) => {
        const node = locator.getAstNode(document.parseResult.value, diagnostic.data.path);

        if (isSdsAnnotationCall(node)){
            const cstNode = node.$cstNode;
        
            if (!cstNode || !node.annotation?.$refText) {
                return;
            }

            const edit: TextEdit = {
                range: cstNode.range,
                newText: '@' + node.annotation?.$nodeDescription?.name,
            }

            acceptor(
                createQuickfixFromTextEditsToSingleDocument(
                    'Remove unnecessary argument list.',
                    diagnostic,
                    document,
                    [edit],
                    true,
                ),
            );  
        }

        if (isSdsCall(node)) {
            const cstNode = node.$cstNode;

            if (!cstNode || node.argumentList.arguments.length > 0) {
                return;
            }

            const edit: TextEdit = {
                range: cstNode.range,
                // remove brackets and spaces in brackets
                newText: node.$cstNode?.text.replace(/\([^)]*\)/g, ""),
            }

            acceptor(
                createQuickfixFromTextEditsToSingleDocument(
                    'Remove unnecessary argument list.',
                    diagnostic,
                    document,
                    [edit],
                    true,
                ),
            );
        }
        return;
    };
}