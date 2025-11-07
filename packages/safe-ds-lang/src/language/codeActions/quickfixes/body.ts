import { Diagnostic, TextEdit } from 'vscode-languageserver';
import { LangiumDocument } from 'langium';
import { SafeDsServices } from '../../safe-ds-module.js';
import { isSdsClassBody, isSdsEnumBody } from '../../generated/ast.js';
import { CodeActionAcceptor } from '../safe-ds-code-action-provider.js';
import { createQuickfixFromTextEditsToSingleDocument } from '../factories.js';

export const removeUnnecessaryBody = (services: SafeDsServices) => {
    const locator = services.workspace.AstNodeLocator;

    return (diagnostic: Diagnostic, document: LangiumDocument, acceptor: CodeActionAcceptor) => {
        const node = locator.getAstNode(document.parseResult.value, diagnostic.data.path);

        if (isSdsClassBody(node)){
            const cstNode = node.$cstNode;

            if (!cstNode || node.members.length > 0) {
                return;
            }
            
            const edit: TextEdit = {
                range: cstNode.range,
                newText: '',
            }

            acceptor(
                createQuickfixFromTextEditsToSingleDocument(
                    'Remove unnecessary empty class body.',
                    diagnostic,
                    document,
                    [edit],
                    true,
                ),
            );
        }

        if (isSdsEnumBody(node)){
            const cstNode = node.$cstNode;

            if (!cstNode || node.variants.length > 0) {
                return;
            }
            
            const edit: TextEdit = {
                range: cstNode.range,
                newText: '',
            }
            
            acceptor(
                createQuickfixFromTextEditsToSingleDocument(
                    'Remove unnecessary empty enum body.',
                    diagnostic,
                    document,
                    [edit],
                    true,
                ),
            );
        }
        
        return;
    };
};