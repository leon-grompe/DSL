import { SafeDsServices } from '../safe-ds-module.js';
import { AstUtils } from 'langium';
import { isSdsAssignment, isSdsPlaceholder, isSdsReference, isSdsCall, isSdsFunction, isSdsSegment, isSdsParameter,
         SdsPlaceholder, SdsCall, SdsParameter, SdsExpression, SdsAssignee,
         SdsStatement,
         SdsPipeline,
         SdsAssignment,
         SdsLocalVariable} from '../generated/ast.js';
import { ClassType } from '../typing/model.js';

export class SafeDsDataFlowAnalyzer {
    constructor(
        private services: SafeDsServices
    ) {}
    
    /* THIS APPROACH DOES NOT WORK, SINCE WE WOULD NEED TO KEEP TRACK OF ALL PLACEHOLDERS TO COMPARE TO
    checkAssigneePositionForSplit(assigneeLists: SdsAssignee[][], correctPosition: number) : Boolean {
        const lastElement = assigneeLists[assigneeLists.length - 1];
        return true;
    }

    getAssignmentsFromFunctionInBackwardSlice(
        placeholder: SdsPlaceholder,
        functionCallName: string,
    ) : SdsAssignee[][] {
        const pipeline = AstUtils.findRootNode(placeholder) as SdsPipeline;
        const pipelineStatements = pipeline.body.statements;
        const backwardsslice = this.services.flow.Slicer.computeBackwardSliceOfPlaceholder(pipelineStatements, placeholder);

        const relevantAssigneeLists : SdsAssignee[][] = [];
        for (const statement of backwardsslice) {
            if (!isSdsAssignment(statement)) continue;
            this.findAssigneesOfFunctionCall(statement, functionCallName, relevantAssigneeLists);
        }
        return relevantAssigneeLists;
    }

    findAssigneesOfFunctionCall(
        assignment: SdsAssignment, 
        functionCallName: string, 
        relevantAssigneeLists: SdsAssignee[][]
    ) {
        const expression = assignment.expression;
        if(!isSdsCall(expression)) return;
        
        const callable = this.services.helpers.NodeMapper.callToCallable(expression);
        if (
            (isSdsFunction(callable) || isSdsSegment(callable)) &&
            callable.name === functionCallName
        ) {
            if (assignment.assigneeList?.assignees) {
                relevantAssigneeLists.push(assignment.assigneeList?.assignees)
            }
            return;
        }
    }
    */
                

    /**
     * Checks if a placeholder is assigned to a specific assginee position by a specific function.
     * @param placeholder The placeholder to check.
     * @param functionCallName The name of the function callable.
     * @param correctAssigneePosition The assignee position to check.
     * @param placeholderBackwardSlice Accumulates the backwardsslice to the placeholder.
     * @returns True, if the placeholder is assigned by the specified function at the specified position. False otherwise.
     */
    checkIfPlaceholderIsAssigneeOfSpecificFunction(
        placeholder: SdsPlaceholder,
        functionCallName: string,
        correctAssigneePosition: number,
        placeholderBackwardSlice: SdsPlaceholder[] = []
    ): boolean {
        const parentAssignment = AstUtils.getContainerOfType(placeholder, isSdsAssignment);

        if (!parentAssignment) {
            return false;
        }

        if (placeholderBackwardSlice.includes(placeholder)) {
            return false;
        }
        placeholderBackwardSlice.push(placeholder);

        const expr = parentAssignment.expression;
        if (!expr) {
            return false;
        }

        if (isSdsCall(expr)) {
            const callable = this.services.helpers.NodeMapper.callToCallable(expr);
            if (
                isSdsFunction(callable) &&
                callable.name === functionCallName &&
                parentAssignment.assigneeList?.assignees[correctAssigneePosition] === placeholder
            ) {
                return true;
            }

            // recurse into segments
            if (isSdsSegment(callable)) {
                for (const segmentStatement of callable.body.statements) {
                    if (!isSdsAssignment(segmentStatement)) continue;

                    const assignees = segmentStatement.assigneeList?.assignees ?? [];
                    for (const assignee of assignees) {
                        if (!isSdsPlaceholder(assignee)) continue; 

                        if (this.checkIfPlaceholderIsAssigneeOfSpecificFunction(
                            assignee,
                            functionCallName,
                            correctAssigneePosition,
                            placeholderBackwardSlice
                        )) {
                            return true;
                        }
                    }
                }
            }

            const referencedPlaceholders = this.extractOnlyDataPlaceholders(expr);
            for (const referencedPlaceholder of referencedPlaceholders) {
                if (this.checkIfPlaceholderIsAssigneeOfSpecificFunction(
                    referencedPlaceholder,
                    functionCallName,
                    correctAssigneePosition,
                    placeholderBackwardSlice
                )) {
                    return true;
                }
            }
            return false;
        }

        if (isSdsReference(expr) && isSdsPlaceholder(expr.target.ref)) {
            return this.checkIfPlaceholderIsAssigneeOfSpecificFunction(
                expr.target.ref,
                functionCallName,
                correctAssigneePosition,
                placeholderBackwardSlice
            );
        }

        return false;
    }


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
     * Checks if any data placeholders in a call reference the training set (assigned by first splitRows at position 0)
     * @param call 
     * @returns True, if the call references the training set through data. False otherwise.
     */
    callReferencesTrainingSet(
        call: SdsCall, 
        paramArgMap: Map<SdsParameter, SdsExpression> = new Map()
    ): boolean {
        const candidates = this.extractOnlyDataPlaceholders(call, paramArgMap);
        
        for (const placeholder of candidates) {
            if (this.checkIfPlaceholderIsAssigneeOfSpecificFunction(
                    placeholder, 'splitRows', 0)
                && 
                !this.checkIfPlaceholderIsAssigneeOfSpecificFunction(
                    placeholder, 'splitRows', 1)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Checks if any data placeholders in a call reference the validation set (assigned by second splitRows at position 0)
     * @param call 
     * @returns True, if the call references the validation set through data. False otherwise.
     */
    callReferencesValidationSet(
        call: SdsCall, 
        paramArgMap: Map<SdsParameter, SdsExpression> = new Map()
    ): boolean{
        const candidates = this.extractOnlyDataPlaceholders(call, paramArgMap);
        
        for (const placeholder of candidates) {
            if (this.checkIfPlaceholderIsAssigneeOfSpecificFunction(
                    placeholder, 'splitRows', 0)
                && 
                this.checkIfPlaceholderIsAssigneeOfSpecificFunction(
                    placeholder, 'splitRows', 1)
                ) {
                return true;
            }
        }
        return false;
    }

    /**
     * Checks if any data placeholders in a call reference the test set (assigned by second splitRows at position 1)
     * @param call 
     * @returns True, if the call references the test set through data. False otherwise.
     */
    callReferencesTestSet(
        call: SdsCall, 
        paramArgMap: Map<SdsParameter, SdsExpression> = new Map()
    ): boolean{
        const candidates = this.extractOnlyDataPlaceholders(call, paramArgMap);
        
        for (const placeholder of candidates) {
            if (!this.checkIfPlaceholderIsAssigneeOfSpecificFunction(
                    placeholder, 'splitRows', 0)
                && 
                this.checkIfPlaceholderIsAssigneeOfSpecificFunction(
                    placeholder, 'splitRows', 1)
                ) {
                return true;
            }
        }
        return false;    
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
     * Extracts all assignments that contain a specific call.
     * When using the callable name 'split' or 'splitRows' it will filter both to work for tabular and image data.
     */
    extractAssignmentsWithSpecificCall(statements: SdsStatement[], callableName: string) : SdsAssignment[] {
        const assignments = statements.filter(statement => isSdsAssignment(statement));
        const assignmentsWithSpecificCalls = assignments.filter(assignment => this.isSpecificCall(assignment, callableName));
        
        return assignmentsWithSpecificCalls;
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
}