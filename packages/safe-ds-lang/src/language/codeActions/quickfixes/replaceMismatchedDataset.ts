import { Diagnostic } from 'vscode-languageserver';
import { AstUtils, LangiumDocument } from 'langium';
import { SafeDsServices } from '../../safe-ds-module.js';
import { isSdsPipeline, isSdsReference } from '../../generated/ast.js';
import { DataSet } from '../../flow/safe-ds-dataset-identifier.js';
import { CodeActionAcceptor } from '../safe-ds-code-action-provider.js';
import { createQuickfixFromTextEditsToSingleDocument } from '../factories.js';

/**
 * When an activity is performed on the wrong dataset partition, replace the offending dataset
 * reference with the most specific variable of the correct dataset available at that point.
 */
export const replaceMismatchedDataset = (services: SafeDsServices) => {
    const locator = services.workspace.AstNodeLocator;
    const identifier = services.flow.DatasetIdentifier;

    return (diagnostic: Diagnostic, document: LangiumDocument, acceptor: CodeActionAcceptor) => {
        // the diagnostic path points directly at the wrong dataset reference
        const node = locator.getAstNode(document.parseResult.value, diagnostic.data?.path);
        if (!isSdsReference(node) || !node.$cstNode) return;

        const pipeline = AstUtils.getContainerOfType(node, isSdsPipeline);
        if (!pipeline) return;

        const expectedDataset = diagnostic.data?.expected as DataSet;
        const correctPlaceholder = identifier.getMostSpecificDatasetPlaceholder(pipeline.body.statements, expectedDataset, node);
        if (!correctPlaceholder) return;

        acceptor(
            createQuickfixFromTextEditsToSingleDocument(
                `Use the ${expectedDataset.toLowerCase()} set ('${correctPlaceholder.name}') instead.`,
                diagnostic,
                document,
                [{ range: node.$cstNode.range, newText: correctPlaceholder.name }],
                true,
            ),
        );
    };
};
