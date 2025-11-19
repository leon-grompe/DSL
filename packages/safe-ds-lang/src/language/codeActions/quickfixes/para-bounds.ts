import { Diagnostic, TextEdit } from 'vscode-languageserver';
import { LangiumDocument } from 'langium';
import { SafeDsServices } from '../../safe-ds-module.js';
import { isSdsCall, SdsExpression, SdsParameterBound } from '../../generated/ast.js';
import { getArguments, Parameter } from '../../helpers/nodeProperties.js';
import { CodeActionAcceptor } from '../safe-ds-code-action-provider.js';
import { createQuickfixFromTextEditsToSingleDocument } from '../factories.js';
import { EvaluatedNode, IntConstant, FloatConstant, StringConstant, BooleanConstant, NullConstant } from '../../partialEvaluation/model.js';
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
const analyzeBound = (leftOp: EvaluatedNode, operator: string, rightOp: EvaluatedNode) => {
    // Helper to extract a primitive JS value from an EvaluatedNode. For numbers we keep
    // number or bigint so comparisons are numeric. For strings we return the raw string
    // value (without quotes). Fallback to the node's toString() if unknown.
    const toPrimitive = (n: EvaluatedNode): number | bigint | string | boolean | null => {
        if (n instanceof IntConstant) return n.value; // bigint
        if (n instanceof FloatConstant) return n.value; // number
        if (n instanceof StringConstant) return n.value; // unquoted string
        if (n instanceof BooleanConstant) return n.value;
        if (n === NullConstant) return null;

        // Try to coerce typical constants represented as strings to numbers
        const maybeNum = Number(n.toString());
        if (!isNaN(maybeNum) && isFinite(maybeNum)) return maybeNum;

        return n.toString();
    };

    const l = toPrimitive(leftOp);
    const r = toPrimitive(rightOp);

    let satisfied = false;
    // Numeric comparisons when both sides are numeric (handle bigint separately)
    if (typeof l === 'bigint' && typeof r === 'bigint') {
        switch (operator) {
            case '<': satisfied = l < r; break;
            case '<=': satisfied = l <= r; break;
            case '>': satisfied = l > r; break;
            case '>=': satisfied = l >= r; break;
            default: satisfied = false;
        }
    } else if ((typeof l === 'number' || typeof l === 'bigint') && (typeof r === 'number' || typeof r === 'bigint')) {
        // convert bigints to numbers for mixed comparison
        const ln = typeof l === 'bigint' ? Number(l) : (l as number);
        const rn = typeof r === 'bigint' ? Number(r) : (r as number);
        switch (operator) {
            case '<': satisfied = ln < rn; break;
            case '<=': satisfied = ln <= rn; break;
            case '>': satisfied = ln > rn; break;
            case '>=': satisfied = ln >= rn; break;
            default: satisfied = false;
        }
    } else {
        // Fallback: string comparison (use string form or raw string for StringConstant)
        const ls = l === null ? 'null' : String(l);
        const rs = r === null ? 'null' : String(r);
        switch (operator) {
            case '<': satisfied = ls < rs; break;
            case '<=': satisfied = ls <= rs; break;
            case '>': satisfied = ls > rs; break;
            case '>=': satisfied = ls >= rs; break;
            default: satisfied = false;
        }
    }

    // Compute replacement suggestion (prefer numeric adjustments where possible)
    let replacement: string | undefined;
    if (typeof r === 'bigint') {
        // bigint adjustments
        switch (operator) {
            case '<': replacement = String((r as bigint) - 1n); break;
            case '<=': replacement = String(r); break;
            case '>': replacement = String((r as bigint) + 1n); break;
            case '>=': replacement = String(r); break;
            default: replacement = undefined;
        }
    } else if (typeof r === 'number') {
        switch (operator) {
            case '<': replacement = String(Math.floor(r) - 1); break;
            case '<=': replacement = String(r); break;
            case '>': replacement = String(Math.floor(r) + 1); break;
            case '>=': replacement = String(r); break;
            default: replacement = undefined;
        }
    } else if (typeof r === 'string') {
        // For string bounds we just echo the right-hand string (no numeric adjustment)
        replacement = r;
    } else {
        replacement = undefined;
    }

    // Map operator to bound type for messages
    let type = '';
    switch (operator) {
        case '<':
        case '<=':
            type = 'upper';
            break;
        case '>':
        case '>=':
            type = 'lower';
            break;
        default:
            type = '';
    }

    return { type, satisfied, replacement };
};

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