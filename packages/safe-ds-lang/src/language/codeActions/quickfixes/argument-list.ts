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

        if (!isSdsAnnotationCall(node)){
            /* c8 ignore next 2 */
            return;
        }
        
        const cstNode = node.$cstNode;
        
        if (!cstNode || node.$container.annotationCalls.length > 1) {
            return;
        }

        const edit: TextEdit = {
            range: cstNode.range,
            newText: '',
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
    };
}