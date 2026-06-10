import { SafeDsServices } from '../safe-ds-module.js';
import { AstNode, AstUtils } from 'langium';
import { isSdsAssignment, isSdsPlaceholder, isSdsReference, isSdsCall, isSdsFunction, isSdsSegment, isSdsParameter, isSdsExpressionStatement, isSdsOutputStatement,
         SdsPlaceholder, SdsCall, SdsParameter, SdsExpression, SdsStatement, SdsAssignment, SdsLocalVariable, SdsSegment,
         } from '../generated/ast.js';
import { ClassType } from '../typing/model.js';

export class SafeDsDataFlowAnalyzer {
    constructor(
        private services: SafeDsServices
    ) {}
    
    /**
     * Extract all placeholders from a call by traversing its AST. 
     * @param call The call to extract placeholders from.
     * @returns An array of all placeholders found in the call.
     */
    private extractPlaceholders(
        call: SdsCall, 
        paramArgMap: Map<SdsParameter, SdsExpression> = new Map()
    ): SdsPlaceholder[] {
        const candidates = new Set<SdsPlaceholder>();
        AstUtils.streamAllContents(call).forEach(node => {
            if (!isSdsReference(node)) return;
            
            const decl = node.target?.ref;
            
            // Direct placeholder reference — existing behaviour
            if (isSdsPlaceholder(decl)) {
                candidates.add(decl);
                return;
            }
            
            // Parameter reference — resolve through paramArgMap to get the pipeline placeholder
            if (isSdsParameter(decl)) {
                const boundExpr = paramArgMap.get(decl);
                if (boundExpr && isSdsReference(boundExpr) && isSdsPlaceholder(boundExpr.target.ref)) {
                    candidates.add(boundExpr.target.ref);
                }
            }
        });
        
        return Array.from(candidates);
    }

    /**
     * Extract all placeholders that are data (Image, ImageList, Cell, Row, Column, Table, Dataset) from a call.
     * @param call The call to extract data placeholders from.
     * @returns An array of all data placeholders found in the call.
     */
    private extractOnlyDataPlaceholders(
        call: SdsCall, 
        paramArgMap: Map<SdsParameter, SdsExpression> = new Map()
    ): SdsPlaceholder[] {
        const candidates = this.extractPlaceholders(call, paramArgMap);
        const dataPlaceholders = candidates.filter(placeholder =>
            this.isData(placeholder)
        );
        return dataPlaceholders;
    }


    /**
     * Checks if a localVariable is actual data (Image, ImageList, any Tabular data or a Dataset).
     */
    isData = (localVariable: SdsLocalVariable): boolean => {
        const typeComputer = this.services.typing.TypeComputer;
        const builtinClasses = this.services.builtins.Classes;
        
        const type = typeComputer.computeType(localVariable);

        // image
        const imageMatch        =  typeComputer.computeMatchingSupertype(type as ClassType, builtinClasses.Image);
        const imageListMatch    =  typeComputer.computeMatchingSupertype(type as ClassType, builtinClasses.ImageList);

        // tabular
        const cellMatch     = typeComputer.computeMatchingSupertype(type as ClassType, builtinClasses.Cell);
        const rowMatch      = typeComputer.computeMatchingSupertype(type as ClassType, builtinClasses.Row);
        const columnMatch   = typeComputer.computeMatchingSupertype(type as ClassType, builtinClasses.Column);
        const tableMatch    = typeComputer.computeMatchingSupertype(type as ClassType, builtinClasses.Table);
        
        // datasets (use only most general supertype)
        const datasetMatch  = typeComputer.computeMatchingSupertype(type as ClassType, builtinClasses.Dataset);

        if(imageMatch || imageListMatch || cellMatch || rowMatch || columnMatch || tableMatch || datasetMatch){
            return true;
        } else { 
            return false;
        }
    }


    /**
     * Checks whether a statement contains a specific call.
     * When using the callable name 'split' or 'splitRows' it will check for both to work for tabular and image data.
     */
    isSpecificCall(statement: SdsStatement, callableName: string) : boolean {
        if (!(isSdsAssignment(statement) && isSdsCall(statement.expression))) return false; 
      
        const callable = this.services.helpers.NodeMapper.callToCallable(statement.expression);
        
        if (callableName === 'split' || callableName === 'splitRows') {
            return isSdsFunction(callable) && 
                (callable.name === 'splitRows' ||
                callable.name === 'split');
        } else {
            return isSdsFunction(callable) && callable.name === callableName;
        }
    }

    /**
     * Extracts all assignments from 'statements' whose call either directly matches
     * 'callableName', or is a segment call that contains 'callableName' somewhere inside it.
     * In the segment case the segment-call assignment is returned, not the internal one.
     * When using the callable name 'split' or 'splitRows' it will filter both to work for tabular and image data.
     */
    extractAssignmentsWithSpecificCall(
        statements: SdsStatement[],
        callableName: string,
    ): SdsAssignment[] {
        const result: SdsAssignment[] = [];

        for (const statement of statements) {
            if (!isSdsAssignment(statement)) continue;

            if (this.isSpecificCall(statement, callableName)) {
                // Direct call: return this assignment.
                result.push(statement);
            } else if (isSdsCall(statement.expression)) {
                // Segment call: return this assignment if the specific call is inside the segment.
                const callable = this.services.helpers.NodeMapper.callToCallable(statement.expression);
                if (isSdsSegment(callable) && this.segmentContainsSpecificCall(callable, callableName, new Set())) {
                    result.push(statement);
                }
            }
        }

        return result;
    }

    /**
     * Returns true if 'segment' contains a call matching 'callableName', either directly
     * or inside a nested segment call. 'visited' prevents re-entering the same segment.
     */
    private segmentContainsSpecificCall(
        segment: SdsSegment,
        callableName: string,
        visited: Set<SdsSegment>,
    ): boolean {
        if (visited.has(segment)) return false;
        visited.add(segment);

        for (const statement of segment.body?.statements ?? []) {
            if (!isSdsAssignment(statement)) continue;

            if (this.isSpecificCall(statement, callableName)) return true;

            if (isSdsCall(statement.expression)) {
                const callable = this.services.helpers.NodeMapper.callToCallable(statement.expression);
                if (isSdsSegment(callable) && this.segmentContainsSpecificCall(callable, callableName, visited)) {
                    return true;
                }
            }
        }

        return false;
    }


    /**
     * Flattens a statement into a list of non-segment calls, recursively inlining segment calls.
     *
     * For each call in the statement (innermost first):
     * - Segment call: replaced by recursively expanding its body, with a resolved paramArgMap
     *   that maps each segment parameter to the argument expression passed at this call site
     *   (substituting any parameter references from the outer paramArgMap).
     * - Function / class call: emitted as-is, paired with the current paramArgMap.
     *
     * The returned paramArgMap for each call lets callers resolve parameter references back to
     * the original pipeline-level expressions, regardless of how many segment layers were crossed.
     */
    expandCallsInStatement(
        statement: SdsStatement,
        paramArgMap: Map<SdsParameter, SdsExpression> = new Map(),
    ): { call: SdsCall, paramArgMap: Map<SdsParameter, SdsExpression>, segmentCallSite?: SdsCall }[] {
        return this._expandCallsInStatement(statement, paramArgMap, undefined);
    }

    private _expandCallsInStatement(
        statement: SdsStatement,
        paramArgMap: Map<SdsParameter, SdsExpression>,
        segmentCallSite: SdsCall | undefined,
    ): { call: SdsCall, paramArgMap: Map<SdsParameter, SdsExpression>, segmentCallSite?: SdsCall }[] {
        if (isSdsExpressionStatement(statement) ||
            isSdsAssignment(statement) ||
            isSdsOutputStatement(statement)) {

            // Get direct calls in this statement, starting from innermost (reverse order)
            const directCalls = AstUtils.streamAst(statement.expression as AstNode)
                .filter(isSdsCall)
                .toArray()
                .reverse();

            const result: { call: SdsCall, paramArgMap: Map<SdsParameter, SdsExpression>, segmentCallSite?: SdsCall }[] = [];

            for (const call of directCalls) {
                const callable = this.services.helpers.NodeMapper.callToCallable(call);

                if (isSdsSegment(callable)) {
                    // Resolve each param's argument expression, substituting outer bindings if needed
                    const segmentParamArgMap = this.services.helpers.NodeMapper.callToParamArgMap(call);
                    const resolvedMap = new Map<SdsParameter, SdsExpression>();

                    // First resolve the direct arguments at this call site
                    for (const [param, arg] of segmentParamArgMap) {
                        let expr = arg.value;
                        // Argument is reference to a parameter in the outer scope:
                        // Substitute with the bound expression from the outer paramArgMap
                        if (isSdsReference(expr) && isSdsParameter(expr.target.ref)) {
                            expr = paramArgMap.get(expr.target.ref) ?? expr;
                        }
                        resolvedMap.set(param, expr);
                    }

                    // Recursively expand into the segment body. Preserve the outermost segment call
                    // site so that all inner calls are tagged with the pipeline-level segment call.
                    for (const segmentStatement of callable.body.statements) {
                        result.push(...this._expandCallsInStatement(
                            segmentStatement, resolvedMap,
                            segmentCallSite ?? call,
                        ));
                    }
                } else {
                    // Function / class call: emit with the paramArgMap from the enclosing segment scope
                    // so callers can resolve any parameter references back to pipeline-level expressions.
                    result.push({ call, paramArgMap, segmentCallSite });
                }
            }

            return result;
        }
        return [];
    }
}