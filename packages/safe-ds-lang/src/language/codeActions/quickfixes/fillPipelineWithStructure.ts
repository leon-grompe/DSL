import { Diagnostic, TextEdit } from 'vscode-languageserver';
import { LangiumDocument } from 'langium';
import { SafeDsServices } from '../../safe-ds-module.js';
import { isSdsPipeline, SdsPipeline } from '../../generated/ast.js';
import { CodeActionAcceptor } from '../safe-ds-code-action-provider.js';
import { createQuickfixFromTextEditsToSingleDocument } from '../factories.js';


export const fillEmptyPipelineWithSuggestedStructure = (services: SafeDsServices) => {
    const locator = services.workspace.AstNodeLocator;
    
    return (diagnostic: Diagnostic, document: LangiumDocument, acceptor: CodeActionAcceptor) => {
        if (!diagnostic.data?.path) return;
        
        const node = locator.getAstNode(document.parseResult.value, diagnostic.data.path);
        if (!isSdsPipeline(node)) {
            return;
        }
        
        const cstNode = node.$cstNode;
        if (!cstNode){
            return;
        }

        const edit: TextEdit = {
            range: cstNode.range,
            newText: insertTextIntoPipeline(node, finalString)
        }

        acceptor(
            createQuickfixFromTextEditsToSingleDocument(
                'Fill with a suggested structure that follows the behaviour protocol.',
                diagnostic,
                document,
                [edit],
                true,
            ),
        );
    };
}

const insertTextIntoPipeline = (pipeline: SdsPipeline, textToInsert: string) : string => {
    if (!pipeline.$cstNode) return '';
    const oldText = pipeline.$cstNode?.text;
    if(!oldText) return '';
    
    const newText = oldText.replace(
        /(pipeline\s\w+\s\{)(\s*)(\})/,
        `$1\n${textToInsert}\n$3`
    );
    return newText
}

const pipelineStructureComments : string[] = [
    'DATA ACQUISTION',
    'DATA PREPARATION',
    'DATA PARTITIONING',
    'DATA PROCESSING',
    'FEATURE ENGINEERING',
    'FEATURE SELECTION',
    'MODELING & TRAINING',
    'EVALUATION',
    'TESTING',
    'INTERPRETATION',
]

const minPadding = 25;
const maxLength = Math.max(...pipelineStructureComments.map(c => c.length));
const totalLength = maxLength + 2 + (minPadding * 2); 

const finalString = pipelineStructureComments
    .map(comment => {
        const totalPadding = totalLength - comment.length - 2;
        const leftPadding = Math.floor(totalPadding / 2);
        const rightPadding = Math.ceil(totalPadding / 2);
        return `// ${'='.repeat(leftPadding)} ${comment} ${'='.repeat(rightPadding)}`;
    })
    .join('\n\n\n') + '\n\n';

