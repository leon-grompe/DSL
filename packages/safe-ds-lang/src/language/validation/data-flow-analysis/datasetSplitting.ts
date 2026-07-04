import { AstUtils, ValidationAcceptor } from 'langium';
import { isSdsCall, isSdsFunction, isSdsPlaceholder, SdsAssignment, SdsPipeline, isSdsAssignment, isSdsReference } from '../../generated/ast.js';
import { getAssignees } from '../../helpers/nodeProperties.js';
import { SafeDsServices } from '../../index.js';

export const CODE_MISSING_DATASET_SPLITTING = 'data-flow-analysis/missing-dataset-split';
export const CODE_ILLEGAL_DATASET_SPLITTING = 'data-flow-analysis/illegal-dataset-split';

export const pipelineShouldContainMultipleSplits = (services: SafeDsServices) => {
    const analyzer = services.flow.DataFlowAnalyzer;
    const locator = services.workspace.AstNodeLocator;

    return (node: SdsPipeline, accept: ValidationAcceptor) => {
        if (!node.body) return;
        const splits = analyzer.extractAssignmentsWithSpecificCall(node.body.statements, 'split');
        if (splits.length === 0) return;

        // a split is "chained" when it references a placeholder produced by another split.
        let hasChainedSplit = false;
        for (const split of splits) {
            // get placeholders in the ast of the split
            AstUtils.streamAllContents(split).forEach((astNode) => {
                if (!isSdsReference(astNode) || !isSdsPlaceholder(astNode.target.ref)) return;

                const target = astNode.target.ref;
                
                // check if target is assigned by another split
                const source = splits.find((other) => other !== split && getAssignees(other).includes(target));
                if (!source) return;

                hasChainedSplit = true;

                // chaining off any assignee other than the second one (the rest set) is incorrect.
                if (getAssignees(source)[1] !== target) {
                    accept('info',
                        'Only the second assignee should be split a second time, since the first assignee is considered as the training set.', {
                            node: split.expression ?? node,
                            code: CODE_ILLEGAL_DATASET_SPLITTING,
                            data: { path: locator.getAstNodePath(split) },
                        }
                    );
                }
            });
        }

        // a single split, or multiple splits none of which chain off another -> recommend a 3-way split.
        if (splits.length === 1 || !hasChainedSplit) {
            accept('info',
                'It is recommended to split the dataset into three parts (training, validation, testing).', {
                    node: splits[0]!.expression ?? splits[0]!,
                    code: CODE_MISSING_DATASET_SPLITTING,
                    data: { path: locator.getAstNodePath(splits[0]!) },
                }
            );
        }
    }
}