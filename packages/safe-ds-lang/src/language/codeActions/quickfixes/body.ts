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

        if(!isSdsClassBody(node) && !isSdsEnumBody(node)){
            /* c8 ignore next 2 */
            return;
        }
        const cstNode = node.$cstNode;

        // from my testing, further checks are not necessary, 
        // as the diagnostic should only be created for empty bodies
        if (!cstNode) {
            return;
        }
        
        const edit: TextEdit = {
            range: cstNode.range,
            newText: '',
        }

        acceptor(
            createQuickfixFromTextEditsToSingleDocument(
                'Remove unnecessary empty body.',
                diagnostic,
                document,
                [edit],
                true,
            ),
        );
    };
};