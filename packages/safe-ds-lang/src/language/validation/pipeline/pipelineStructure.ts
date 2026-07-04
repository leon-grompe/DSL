import { ValidationAcceptor } from 'langium';
import { SdsPipeline } from '../../generated/ast.js';
import { SafeDsServices } from '../../index.js';

export const CODE_SUGGEST_PIPELINE_STRUCTURE = 'pipeline/pipeline-suggestion'

export const suggestPipelineStructure = (services: SafeDsServices) => {
    const locator = services.workspace.AstNodeLocator;
    return (node : SdsPipeline, accept: ValidationAcceptor) => {
        // check if pipeline is empty (no statements and no comments)
        if (!node.body) return;
        if (!/(pipeline\s+\w+\s*\{)(\s*)(\})/.test(node.$cstNode?.text ?? '') || node.body.statements.length > 0){ 
            return; 
        }
        
        accept('info',
            'This pipeline is empty. Get started by inserting the recommended data-science pipeline structure.', {
                node: node, 
                property: 'name',
                code: CODE_SUGGEST_PIPELINE_STRUCTURE,
                data: { path: locator.getAstNodePath(node) }
            }
        );
        return;
    }
}