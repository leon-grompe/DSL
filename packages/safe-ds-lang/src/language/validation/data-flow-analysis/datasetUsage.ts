import { AstUtils, EMPTY_STREAM, ValidationAcceptor } from 'langium';
import { SafeDsServices } from '../../safe-ds-module.js';
import { SdsPlaceholder, SdsCall, isSdsFunction, isSdsReference, isSdsPlaceholder, SdsPipeline, SdsStatement, isSdsAssignment, isSdsCall, SdsAssignee, SdsAssignment, SdsFunction, SdsReference, isSdsMemberAccess, isSdsSegment, SdsDeclaration, SdsArgument, isSdsArgument, SdsLocalVariable, isSdsParameter, isSdsParameterList, isSdsAssigneeList } from '../../generated/ast.js';
import { SafeDsNodeMapper } from '../../helpers/safe-ds-node-mapper.js';
import { Stream } from 'langium';

export const CODE_TEST_DATA_USED_FOR_TRAINING = 'data-flow-analysis/test-data-used-for-training';


export const testDataUsedForTraining = (services: SafeDsServices) => {
    const nodeMapper = services.helpers.NodeMapper; 
    const analyzer = services.flow.DataFlowAnalyzer;
    
    return (node: SdsPipeline, accept: ValidationAcceptor) => {
        const pipelineStatements = node.body.statements;
        const assignments = pipelineStatements.filter(isSdsAssignment);

        // Extract assignments with split calls
        const splitAssignments = analyzer.extractAssignmentsWithSpecificCall(assignments, 'split');
            //console.log('\n' + "SPLIT ==============================================");
            //console.log(assignmentsWithSplitCalls.map(assignment => assignment.$cstNode?.text));

        // Extract training calls
        const fitAssignments = analyzer.extractAssignmentsWithSpecificCall(assignments, 'fit');
        const fitCalls = fitAssignments.map(assignment => assignment.expression as SdsCall);
            //console.log('\n' + "FITS ==============================================");
            //console.log(fitCalls.map(call => call.$cstNode?.text));

        // Determine placeholder to compute forward slice from
        const trainingSetPlaceholder = splitAssignments[0]?.assigneeList?.assignees[0];
            //console.log("TRAINING SET =======================================")
            //console.log(trainingSetPlaceholder?.$cstNode?.text);

        // Compute all forward references of the training set
        const forwardVariables = services.flow.Slicer.computeForwardSliceFromVariable(trainingSetPlaceholder as SdsPlaceholder);
            console.log("FORWARD SLICE VARIABLES ===========================")
            console.log(forwardVariables.map(variable => variable.$cstNode?.text));
            //console.log(Array.from(forwardReferences).map(ref => ref.target.ref?.$cstNode?.text))


        for (const call of fitCalls) {
            const argumentArray = call.argumentList.arguments;
            for (const argument of argumentArray) {
                if (forwardVariables.some(variable => 
                    isSdsReference(argument.value) &&
                    variable === argument.value.target.ref)) {
                        //console.log("EQUAL FOR: " + call.$cstNode?.text);
                        //console.log("WITH ARGUMENT: " + argument.$cstNode?.text);
                } else {
                    //console.log("NOT EQUAL FOR: " + call.$cstNode?.text);
                    //console.log("WITH ARGUMENT " + argument.$cstNode?.text);
                }
            }
        }
        checkSplitCalls(pipelineStatements, nodeMapper);
    }
}

function checkSplitCalls(pipeline : SdsStatement[], nodeMapper : SafeDsNodeMapper) : Boolean {

    // ---------------------------------------------------------------------------------
    // Forward slice of split calls
    // ---------------------------------------------------------------------------------
 
    // Extract assignments with split calls
    const assignments = pipeline.filter(statement => isSdsAssignment(statement));
    const assignmentsWithSplitCalls = assignments.filter(assignment => isSplitCall(assignment, nodeMapper));
    // THEORETISCH AUCH REKURSIV DURCH SEGMENTS EXTRAHIEREN (wie unten)

        //console.log("SPLIT ==============================================");
        //console.log(assignmentsWithSplitCalls.map(assignment => assignment.$cstNode?.text));

    // Determine forward slice of first result argument of the first split call:   
    const trainingSetPlaceholder = assignmentsWithSplitCalls[0]?.assigneeList?.assignees[0];
    
    //console.log("PLACEHOLDER TO REFS");
    const references = nodeMapper.placeholderToReferences(trainingSetPlaceholder as SdsPlaceholder).toArray();
    //console.log(references.map(ref => ref.target.ref?.$cstNode?.text));
    
    // Accumulator for the forward slice.    
    const forwardSlice : SdsCall[] = [];
    getFunctionCallsInForwardSlice(trainingSetPlaceholder as SdsPlaceholder, forwardSlice, nodeMapper);

    console.log("SLICE ==============================================");
    console.log(forwardSlice.map(call => call.$cstNode?.text));

    // ---------------------------------------------------------------------------------
    // Training calls 
    // ---------------------------------------------------------------------------------

    // Extract training calls
    const assignmentsWithTrainingCalls = assignments.filter(assignment => isTrainingCall(assignment, nodeMapper));
    const fitCalls = assignmentsWithTrainingCalls.map(assignment => assignment.expression as SdsCall);
        //console.log("FIT ==============================================");
        //console.log(fitCalls.map(call => call.$cstNode?.text));
    
    // TODO for Leon: Genau wie bei dem forward slice auch hier die Segments durchsuchen, 
    // um auch darin training calls zu finden, die inidrekt in der Pipeline enthalten sind.
    // EXTRAHIERE REKURSIV DURCH DIE SEGMENTS

    // ---------------------------------------------------------------------------------
    // Check if there are training calls that are not in the forward slice of the first split call. 
    // ---------------------------------------------------------------------------------
    
    const trainingCallsNotInForwardSlice = fitCalls.filter(training_call => !forwardSlice.includes(training_call));
    
    // TODO for Leon: Fehlerbehandlung für die training calls, die NICHT im forward slice sind.
    // EIGENTLICHE VALIDATION LOGIK
    //console.log("FIT NOT IN FORWARD SLICE ======================");
    //console.log(trainingCallsNotInForwardSlice.map(call => call.$cstNode?.text));
    
    return trainingCallsNotInForwardSlice.length > 0;
}

function isSplitCall(statement : SdsStatement, nodeMapper : SafeDsNodeMapper) : Boolean {
    // Each statement is an assignment and the split call can only appear 
    // on its right hand side, as a a function call with the name "split" 
    if (!(isSdsAssignment(statement) && isSdsCall(statement.expression))) return false; 
      
    const callable = nodeMapper.callToCallable(statement.expression);
        
    return  isSdsFunction(callable) && 
            (callable.name === 'splitRows' ||
            callable.name === 'split');
}

function isTrainingCall(statement : SdsStatement, nodeMapper: SafeDsNodeMapper) : Boolean {
    // Each statement is an assignment and the training call can only appear 
    // on its right hand side, as a a function call with the name "fit" 
    // (and some more contitions that I leave to TODO to you to implement)
    if (!(isSdsAssignment(statement) && isSdsCall(statement.expression))) return false; 
      
    const callable = nodeMapper.callToCallable(statement.expression);
        
    return isSdsFunction(callable) && callable.name === 'fit';
}

// The forward slice of a placeholder is the set of statements 
// that are data dependent on it. However, we only want function calls.
function getFunctionCallsInForwardSlice(
    localVariable : SdsLocalVariable, 
    slice : SdsCall[], 
    nodeMapper : SafeDsNodeMapper
) : void {
    let references : Stream<SdsReference> = EMPTY_STREAM;
    if (isSdsPlaceholder(localVariable)) {
        references = nodeMapper.placeholderToReferences(localVariable);
    }

    if (isSdsParameter(localVariable)) {
        references = nodeMapper.parameterToReferences(localVariable);
    }

    //console.log("REFERENCES")
    //console.log(references.map(ref => ref.target.ref?.$cstNode?.text))
    references.forEach(reference => {

        // Handle references expands the slice and returns the
        // assignment with which we must continue the traversal, if any.
        const containingAssignment = handleReference(reference, slice, nodeMapper);
        
        // Append the references to the placeholders on the LHS of the assignment 
        // to the references to be processed in the next iterations of the loop. 
        addReferencesToLHS(containingAssignment, references, nodeMapper);
   
    });
}

// Append to the second argument all the references to the placeholders 
// on the LHS of the assignment passed in the first argument.
function addReferencesToLHS(
    assignment: SdsAssignment | undefined, 
    references: Stream<SdsReference>, 
    nodeMapper : SafeDsNodeMapper
) : void {
    const lhs_placeholders = assignment?.assigneeList?.assignees;
    if (!lhs_placeholders) return;
    
    lhs_placeholders.forEach(placeholder => {
        references.concat(nodeMapper.placeholderToReferences(placeholder as SdsPlaceholder))
    })
}

/* Each reference is either the RHS of an assignment or the argument
 * of a function call or of a segment call. In the second case we need
 * to find the containing function call and add it to the forward slice. 
 * 
 * If the reference is the argument of a segment call, we need to 
 * recursively analyse the segment definition, treating the argument 
 * to parameter mapping in which the placeholder appears like an 
 * additional assignment.
 *
 * If the placeholder or its containing callable are the RHS of 
 * an assignment, we also need to add recusively the functions in the
 * forward slice of all placeholders on the LHS of that assignment.
 */
function handleReference(
    reference: SdsReference, 
    slice: SdsCall[], 
    nodeMapper : SafeDsNodeMapper
): SdsAssignment | undefined {
    // The assignment with whose LHS we need to continue the forward slice traversal.
    const containingAssignment = AstUtils.getContainerOfType(reference, isSdsAssignment); // can be undefined

    // The parent of the placeholder is either an assignment, a function call or a segment call. 
    const containingCall = AstUtils.getContainerOfType(reference, isSdsCall);
    //console.log("CONTAINING CALL")
    //console.log(containingCall?.$cstNode?.text);
    if (containingCall) {
        const callable = nodeMapper.callToCallable(containingCall);
        //console.log("CALLABLE")
        //console.log(callable?.$cstNode?.text)
        if (isSdsFunction(callable)) {
            slice.push(containingCall);
        }
        if (isSdsSegment(callable)) {
            // Find the parameter to which the placeholder is assigned in the call.
            const relevantArg = AstUtils.getContainerOfType(reference, isSdsArgument);
            const parameter = nodeMapper.argumentToParameter(relevantArg);

            //console.log("HANDLE REFERENCE SEGMENT")
            //console.log(relevantArg?.$cstNode?.text)
            //console.log(parameter?.$cstNode?.text)
            //console.log("===== ENDE =====")
            // Call our function recursively and add the result to our slice.
            getFunctionCallsInForwardSlice(parameter as SdsLocalVariable, slice, nodeMapper);
        }
    }
    return containingAssignment;
}



// ----------------------------------------------------------------------

export const testDataUsedForTraining1 = (services: SafeDsServices) => {
    const locator = services.workspace.AstNodeLocator;
    const nodeMapper = services.helpers.NodeMapper;
    const analyzer = services.flow.DataFlowAnalyzer;
    
    return (node: SdsCall, accept: ValidationAcceptor) => {
        // Check if node is 'fit' call
        const nodesCallable = nodeMapper.callToCallable(node);
        if (!isSdsFunction(nodesCallable) || nodesCallable.name !== 'fit') {
            return;
        }

        const argList = node.argumentList.arguments;
        for (const arg of argList){
            if (!isSdsReference(arg.value)){
                continue;
            }
            const refPlacehldr = arg.value.target.ref;
            if (!isSdsPlaceholder(refPlacehldr)){continue;}
            
            const placeholders : SdsPlaceholder[] = [];
            const found = analyzer.checkIfPlaceholderIsAssigneeOfSpecificFunction(refPlacehldr, 'splitRows', 1, placeholders);

            // If found, try to pick the most specific placeholder collected; fall back to the original
            const problemPlaceholder = found ? (placeholders[placeholders.length - 1] ?? refPlacehldr) : null;

            // account for 0-based line numbers
            const line = (problemPlaceholder?.$cstNode?.range.start.line ?? 0) + 1;

            if (found) {
                accept('warning', `Testing Dataset resulting from Assignment of Placeholder '${problemPlaceholder?.name}' in line ${line} should not be used to train a Model`, {
                    node: node,
                    property: 'argumentList',
                    code: CODE_TEST_DATA_USED_FOR_TRAINING,
                    data: { path: locator.getAstNodePath(node) },
                });
            }
        }
    }
}