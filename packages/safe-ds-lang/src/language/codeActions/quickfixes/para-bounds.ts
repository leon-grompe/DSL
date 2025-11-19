import { Diagnostic, TextEdit } from 'vscode-languageserver';
import { LangiumDocument } from 'langium';
import { SafeDsServices } from '../../safe-ds-module.js';
import { isSdsCall, isSdsComparisonOperator, SdsExpression, SdsParameterBound } from '../../generated/ast.js';
import { getArguments, Parameter } from '../../helpers/nodeProperties.js';
import { CodeActionAcceptor } from '../safe-ds-code-action-provider.js';
import { createQuickfixFromTextEditsToSingleDocument } from '../factories.js';
import { EvaluatedNode, FloatConstant, IntConstant } from '../../partialEvaluation/model.js';
import { Position, Range } from 'vscode-languageserver-types';
import { SafeDsPartialEvaluator } from '../../partialEvaluation/safe-ds-partial-evaluator.js';

export const setArgumentsToParameterBounds = (services: SafeDsServices) => {
    const locator = services.workspace.AstNodeLocator;
    const nodeMapper = services.helpers.NodeMapper;
    const partialEvaluator = services.evaluation.PartialEvaluator;

    return (diagnostic: Diagnostic, document: LangiumDocument, acceptor: CodeActionAcceptor) => {
        const node = locator.getAstNode(document.parseResult.value, diagnostic.data?.path);
        
        if (!isSdsCall(node)) {
            return;
        }
        
        const substitutions = partialEvaluator.computeParameterSubstitutionsForCall(node);

        for (const arg of getArguments(node)) {
            const cstNode = arg.$cstNode;
            
            if (!cstNode) {
                continue;
            }

            // Only proceed if diagnostic range intersects with arguments CST Node range
            // This way only quickfixes for the argument that caused the diagnostic will show
            const diagRange = diagnostic.range;
            if (diagRange && cstNode.range) {
                if (!rangesIntersect(diagRange, cstNode.range)) {
                    continue;
                }
            }

            const param = nodeMapper.argumentToParameter(arg);
            if (!param) {
                continue;
            }

            const bounds = Parameter.getBounds(param);
            if (bounds.length === 0) {
                continue;
            }

            const leftVal = partialEvaluator.evaluate(arg.value,substitutions);
            
            for (const bound of bounds) {
                // 
                console.log('Processing bound:', bound.operator, bound.rightOperand.$cstNode?.text);

                const rightVal = partialEvaluator.evaluate(bound.rightOperand, substitutions);
                const operator = bound.operator;
                
                const boundInfo = analyzeBound(leftVal, operator, rightVal);
                
                //
                console.log(`Bound analysis for argument to parameter ${param.name}:`, boundInfo);
                console.log(leftVal.toString(),operator, rightVal.toString(), boundInfo.satisfied);
                
                // If bound is not satisfied, create quickfix
                if (!boundInfo.satisfied) {
                    const edit: TextEdit = {
                        range: cstNode.range,
                        newText: `${boundInfo.replacement}`,
                    };

                    acceptor(
                        createQuickfixFromTextEditsToSingleDocument(
                            `Set argument ${nodeMapper.argumentToParameter(arg)?.name} to ${boundInfo.replacement} 
                            to satisfy its ${boundInfo.type} bound of ${operator}${rightVal}.`,
                            diagnostic,
                            document,
                            [edit],
                            true,
                        ),
                    );
                }
            }
        }
    }
}

/**
 * Analyze a bound and determine if it's satisfied, along with a replacement if not.
 * Also returns the type of bound ('upper' or 'lower').
 */
const analyzeBound = (leftOp : EvaluatedNode, operator: string, rightOp : EvaluatedNode) => {   
    let type : string = '';
    let satisfied : boolean = false;
    let replacement : string = '';

    if ((!(leftOp instanceof FloatConstant) && !(leftOp instanceof IntConstant)) ||
        !isSdsComparisonOperator(operator) ||
        (!(rightOp instanceof FloatConstant) && !(rightOp instanceof IntConstant))
    ) {
        return {type, satisfied, replacement};
    }

    const leftVal = leftOp.value;
    const rightVal = rightOp.value;

    const rightValue = rightOp.toString();
    const numericValue = Number(rightValue);
    
    // Check if we can parse as number for adjustment
    const isNumeric = !isNaN(numericValue) && isFinite(numericValue);

    switch (operator) {
        case '<':
            type = 'upper';
            satisfied = leftVal < rightVal;
            replacement = isNumeric ? String(Math.floor(numericValue) - 1) : '';
            break;
        case '<=':
            type = 'upper';
            satisfied = leftVal <= rightVal;
            replacement = isNumeric ? String(numericValue) : '';
            break;
        case '>':
            type = 'lower';
            satisfied = leftVal > rightVal;
            replacement = isNumeric ? String(Math.floor(numericValue) + 1) : '';
            break;
        case '>=':
            type = 'lower';
            satisfied = leftVal >= rightVal;
            replacement = isNumeric ? String(numericValue) : '';
            break;
        default:
            type = '';
            satisfied = false;
            replacement = '';
    }
    return {type, satisfied, replacement};
}

/**
 * Check if two ranges intersect
 */
const rangesIntersect = (range1: Range, range2: Range) => {
    // range1
    const r1Start = range1.start;
    const r1End = range1.end;
    // range2
    const r2Start = range2.start;
    const r2End = range2.end;

    const before =  (a: Position, b: Position) => a.line < b.line || 
                    (a.line === b.line && a.character < b.character);

    // range1 is before range2
    if (before(r1End, r2Start)) return false;
    // range2 is before range1
    if (before(r2End, r1Start)) return false;
    return true;
};