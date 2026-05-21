import { AstUtils, ValidationAcceptor, ValidationSeverity } from 'langium';
import { isSdsCall, isSdsFunction, isSdsPlaceholder, SdsAssignment, SdsCall, SdsPipeline, SdsParameter, SdsExpression, SdsStatement, isSdsAssignment, isSdsReference } from '../../generated/ast.js';
import { SafeDsServices } from '../../index.js';
import { Activity, ValidationContext } from './model.js';
import { ValidationResult, ValidationError} from './validationDataStructures.js'
import { behaviourProtocol } from './behaviourProtocol.js';

export const CODE_DATASET_SPLITTING = 'pipeline/dataset-splitting';

export const pipelineShouldContainMultipleSplits = (services: SafeDsServices) => {
    const nodeMapper = services.helpers.NodeMapper;
    const builtinAnnotations = services.builtins.Annotations;
    const analyzer = services.flow.DataFlowAnalyzer;
    
    return (node: SdsPipeline, accept: ValidationAcceptor) => {
        const splitStatements: { assignment: SdsAssignment; call: SdsCall }[] = [];
        
        for (const statement of node.body.statements) {
            if (!isSdsAssignment(statement)) continue;
            
            for (const call of nodeMapper.statementToCalls(statement).map(({ call }) => call)) {

                if (!isSdsCall(call)) continue;
                const callable = nodeMapper.callToCallable(call);
                
                if (callable && isSdsFunction(callable) && callable.name === 'splitRows') {
                    splitStatements.push({assignment: statement, call: call });
                }
            }
        }

        //if (splits.length === 1)
        // splitting test into validation and test is recommended

        
        for (const current of splitStatements) {
            const otherAssignees = splitStatements
                .filter(s => s !== current)
                .flatMap(s => s.assignment.assigneeList?.assignees ?? []);

            AstUtils.streamAllContents(current.assignment).forEach(node => {
                if (isSdsReference(node) && isSdsPlaceholder(node.target.ref)) {
                    if (otherAssignees.includes(node.target.ref)) {
                        console.log("reference points to placeholder from another split call")
                        // does it reference the assignee at index 1?
                        // if yes -> its good
                        // if not -> its bad, need to change it
                       
                    }
                }
            });
        }
    }
}