import { SafeDsServices } from '../safe-ds-module.js';
import { AstNode, AstUtils } from 'langium';
import { isSdsAssignment, isSdsPlaceholder, isSdsReference, isSdsCall, isSdsFunction, isSdsSegment, isSdsParameter, isSdsExpressionStatement, isSdsOutputStatement, isSdsMemberAccess,
         SdsPlaceholder, SdsCall, SdsParameter, SdsExpression, SdsStatement, SdsAssignment, SdsLocalVariable, SdsSegment,
         } from '../generated/ast.js';
import { ClassType } from '../typing/model.js';
import { getArguments, getAssignees, getParameters } from '../helpers/nodeProperties.js';

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
     * Returns the placeholder that represents the training set:
     * assignee[0] of the first split call in the pipeline.
     */
    private getTrainingSetPlaceholder(statements: SdsStatement[]): SdsPlaceholder | undefined {
        const firstSplit = this.extractAssignmentsWithSpecificCall(statements, 'split')[0];
        if (!firstSplit) {
            return undefined;
        } else {
            return this.getSplitAssignees(firstSplit)[0];
        }
    }

    /**
     * Returns the placeholder that represents the validation set:
     * assignee[0] of the direct split call (after the first) whose member-access receiver
     * is a direct reference to the rest set (assignee[1] of the first split).
     */
    private getValidationSetPlaceholder(statements: SdsStatement[]): SdsPlaceholder | undefined {
        const validationSplit = this.getValidationSplitAssignment(statements);
        if (!validationSplit) {
            return undefined;
        } else {
            return this.getSplitAssignees(validationSplit)[0];
        }
    }

    /**
     * Returns the placeholder that represents the test set.
     * If a validation split exists: assignee[1] of that split.
     * Otherwise: assignee[1] of the first split (the rest set).
     */
    private getTestSetPlaceholder(statements: SdsStatement[]): SdsPlaceholder | undefined {
        const validationSplit = this.getValidationSplitAssignment(statements);
        if (validationSplit) {
            return this.getSplitAssignees(validationSplit)[1];
        } else {
            return this.getRestSetPlaceholder(statements);
        }
    }

    /**
     * Returns true if any data-typed reference argument of 'call' is derived from the training set.
     */
    callReferencesTrainingSet(call: SdsCall, statements: SdsStatement[]): boolean {
        const trainingSet = this.getTrainingSetPlaceholder(statements);
        if (!trainingSet) return false;
        return this.anyArgInForwardSliceOfTarget(call, trainingSet);
    }

    /**
     * Returns true if any data-typed reference argument of 'call' is derived from the validation set.
     */
    callReferencesValidationSet(call: SdsCall, statements: SdsStatement[]): boolean {
        const validationSet = this.getValidationSetPlaceholder(statements);
        if (!validationSet) return false;
        return this.anyArgInForwardSliceOfTarget(call, validationSet);
    }

    /**
     * Returns true if any data-typed reference argument of 'call' is derived from the test set.
     */
    callReferencesTestSet(call: SdsCall, statements: SdsStatement[]): boolean {
        const testSet = this.getTestSetPlaceholder(statements);
        if (!testSet) return false;
        return this.anyArgInForwardSliceOfTarget(call, testSet);
    }

    // Returns the first and second placeholder assignees of a split assignment.
    private getSplitAssignees(assignment: SdsAssignment): [SdsPlaceholder | undefined, SdsPlaceholder | undefined] {
        const assignees = getAssignees(assignment);
        const first  = isSdsPlaceholder(assignees[0]) ? assignees[0] : undefined;
        const second = isSdsPlaceholder(assignees[1]) ? assignees[1] : undefined;
        return [first, second];
    }

    // assignee[1] of the first split, the "rest" that is split further into validation/test.
    private getRestSetPlaceholder(statements: SdsStatement[]): SdsPlaceholder | undefined {
        const firstSplit = this.extractAssignmentsWithSpecificCall(statements, 'split')[0];
        if (!firstSplit) return undefined;
        return this.getSplitAssignees(firstSplit)[1];
    }

    // Finds the direct split call (after the first) whose member-access receiver is a direct
    // reference to the rest set. Returns undefined if no such split exists.
    private getValidationSplitAssignment(statements: SdsStatement[]): SdsAssignment | undefined {
        const restSet = this.getRestSetPlaceholder(statements);
        if (!restSet) return undefined;

        let isFirst = true;
        for (const statement of statements) {
            if (!isSdsAssignment(statement) || !this.isSpecificCall(statement, 'split')) continue;
            // Skip the first split
            if (isFirst) { isFirst = false; continue; }

            const call = statement.expression as SdsCall;
            if (isSdsMemberAccess(call.receiver)) {
                const base = call.receiver.receiver;
                if (isSdsReference(base) && base.target.ref === restSet) return statement;
            }
        }
        return undefined;
    }

    // Returns true if any data-typed reference argument of 'call' is in the forward slice of 'target'.
    private anyArgInForwardSliceOfTarget(call: SdsCall, target: SdsPlaceholder): boolean {
        const forwardSlice = this.services.flow.Slicer.computeForwardSliceFromVariable(target);
        return call.argumentList.arguments.some(arg => {
            if (!isSdsReference(arg.value)) return false;
            const ref = arg.value.target.ref;
            return isSdsPlaceholder(ref) && forwardSlice.some(v => v === ref);
        });
    }

    /**
     * Checks if a placeholder is actual data (Image, ImageList, any Tabular data or a Dataset).
     * @param localVariable 
     * @returns True if the placeholder is data. False otherwise.
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
     * Returns all calls that are being made by the given statement, if any.
     * If no call can be found, returns an empty array.
     * For chained expressions, all calls in the chain are returned (from innermost to outermost).
     *
     * @param statement The statement to extract calls from.
     * @returns An array of all calls in the statement, or an empty array if none found.
     */
    expandSegmentCallsInStatement(
        statement: SdsStatement, 
        paramArgMap: Map<SdsParameter, SdsExpression> = new Map()
    ): { call: SdsCall, paramArgMap: Map<SdsParameter, SdsExpression> }[] {
        if (isSdsExpressionStatement(statement) ||
            isSdsAssignment(statement) ||
            isSdsOutputStatement(statement)) {

            const directCalls = AstUtils.streamAst(statement.expression as AstNode)
                .filter(isSdsCall)
                .toArray();
            directCalls.reverse();

            const result: { call: SdsCall, paramArgMap: Map<SdsParameter, SdsExpression> }[] = [];

            for (const call of directCalls) {
                const callable = this.services.helpers.NodeMapper.callToCallable(call);

                if (isSdsSegment(callable)) {
                    // Build param->arg map for this segment call
                    const segmentParams = getParameters(callable);
                    const segmentArgs = getArguments(call);
                    const segmentParamArgMap = this.services.helpers.NodeMapper.parametersToArguments(segmentParams, segmentArgs);
                    
                    // Resolve each param's argument expression, substituting outer bindings if needed
                    const resolvedMap = new Map<SdsParameter, SdsExpression>();
                    for (const [param, arg] of segmentParamArgMap) {
                        let expr = arg.value;
                        // If the argument is a reference to a parameter in the outer map, resolve it
                        if (isSdsReference(expr) && isSdsParameter(expr.target.ref)) {
                            const outerExpr = paramArgMap.get(expr.target.ref);
                            if (outerExpr) expr = outerExpr;
                        }
                        resolvedMap.set(param, expr);
                    }

                    for (const segmentStatement of callable.body.statements) {
                        result.push(...this.expandSegmentCallsInStatement(segmentStatement, resolvedMap));
                    }
                } else {
                    result.push({ call, paramArgMap });
                }
            }

            return result;
        }
        return [];
    }
}