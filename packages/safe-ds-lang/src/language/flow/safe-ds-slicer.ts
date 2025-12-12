import { SafeDsServices } from '../safe-ds-module.js';
import { isSdsAssignment, isSdsPlaceholder, isSdsReference, SdsPlaceholder, SdsStatement, SdsCall, SdsArgumentList, SdsArgument, SdsReference, isSdsCall, isSdsFunction, isSdsDeclaration, SdsExpression, isSdsChainedExpression, isSdsExpression, isSdsMemberAccess } from '../generated/ast.js';
import { AstUtils, Stream } from 'langium';
import { ImpurityReason } from '../purity/model.js';
import { getAssignees } from '../helpers/nodeProperties.js';
import { SafeDsPurityComputer } from '../purity/safe-ds-purity-computer.js';
import { integer } from 'vscode-languageserver';
import { SafeDsNodeMapper } from '../helpers/safe-ds-node-mapper.js';

export class SafeDsSlicer {
    private readonly purityComputer: SafeDsPurityComputer;

    constructor(services: SafeDsServices) {
        this.purityComputer = services.purity.PurityComputer;
    }

    /**
     * Computes the subset of the given statements that are needed to calculate the target placeholders.
     */
    computeBackwardSliceToTargets(statements: SdsStatement[], targets: SdsStatement[]): SdsStatement[] {
        const aggregator = new BackwardSliceAggregator(this.purityComputer);

        for (const statement of statements.reverse()) {
            // Keep if it is a target
            if (targets.includes(statement)) {
                aggregator.addStatement(statement);
            }

            // Keep if it declares a referenced placeholder
            else if (
                isSdsAssignment(statement) &&
                getAssignees(statement).some((it) => isSdsPlaceholder(it) && aggregator.referencedPlaceholders.has(it))
            ) {
                aggregator.addStatement(statement);
            }

            // Keep if it has an impurity reason that affects a future impurity reason
            else if (
                this.purityComputer
                    .getImpurityReasonsForStatement(statement)
                    .some((pastReason) =>
                        aggregator.impurityReasons.some((futureReason) =>
                            pastReason.canAffectFutureImpurityReason(futureReason),
                        ),
                    )
            ) {
                aggregator.addStatement(statement);
            }
        }

        return aggregator.statements;
    }

    computeBackwardSliceToTargetsWithoutPurity(statements: SdsStatement[], targets: SdsStatement[]): SdsStatement[]{
        const aggregator = new BackwardSliceAggregator(this.purityComputer);


        for (const statement of statements.reverse()) {
            // Keep if it is a target
            if (targets.includes(statement)) {
                aggregator.addStatementWithoutPurity(statement);
            }

            // Keep if it declares a referenced placeholder
            else if (
                isSdsAssignment(statement) &&
                getAssignees(statement).some((it) => isSdsPlaceholder(it) && aggregator.referencedPlaceholders.has(it))
            ) {
                aggregator.addStatementWithoutPurity(statement);
            }
        }

        return aggregator.statements;
    }


    checkIfArgumentIsAssigneeOfSpecificFunction(
        placeholder: SdsPlaceholder, 
        functionCallName: string, 
        correctAssigneePosition: integer, 
        services: SafeDsServices, 
        results: SdsPlaceholder[]
    ) {
        const nodeMapper = services.helpers.NodeMapper;
        results.push(placeholder);
        if (!placeholder) { return; }
        
        const parentAssList = placeholder.$cstNode?.container?.astNode;
        const parentAssignment = parentAssList?.$cstNode?.container?.astNode;
        /*
        // debug print
        console.log('assignment: ' + parentAssignment?.$cstNode?.text);
        */
        if(!isSdsAssignment(parentAssignment)){ return; }
        
        const expr = parentAssignment.expression;
        if(!expr){ return; }
        
        if(isSdsCall(expr)){
            /*
            // debug print
            console.log('expression ' + expr.$cstNode?.text + ' is a call');
            */
            const callable = nodeMapper.callToCallable(expr);

            // Not the target call
            if (!isSdsFunction(callable) || callable.name != functionCallName){
                /*
                // debug print
                console.log('callable ' + callable?.$cstNode?.text + ' ');
                */
                // Call recursively on all args
                this.checkCallArguments(expr, functionCallName, correctAssigneePosition, services, results);
            }
            
            // Is the target call
            else {
                // Placeholder is at correct position -> need to go deeper
                if (parentAssignment.assigneeList?.assignees[correctAssigneePosition] === placeholder){
                    this.checkCallArguments(expr, functionCallName, correctAssigneePosition, services, results);
                }
                // Placeholder is at wrong position -> can stop here
                else { return; }

            }
        }
        else {
            /*
            // Debug print
            console.log('expression ' + expr.$cstNode?.text + ' is a NOT call')
            */
            if(!isSdsReference(expr)){ return; }
            if(!isSdsDeclaration(expr.target)){ return; }
            if(!isSdsPlaceholder(expr.target.ref)){ return;}
            this.checkIfArgumentIsAssigneeOfSpecificFunction(
                expr.target.ref, 
                functionCallName, 
                correctAssigneePosition, 
                services, results
            );
        }     
    }

    // PROBLEM: does not get receiver correctly!!!
    checkCallArguments(
        call: SdsCall, 
        functionCallName: string, 
        correctAssigneePosition: integer, 
        services: SafeDsServices,
        results: SdsPlaceholder[]
    ) {
        if (!call) { return; }
        if (!isSdsExpression) { return; }
        if (isSdsChainedExpression(call)){
            /*
            // debug print
            console.log('actual receiver type: ' + call.receiver.$type);
            console.log(call.receiver.$cstNode?.text)
            */
            if (isSdsMemberAccess(call.receiver)){
                const receiver = call.receiver.receiver;
                /*
                // debug print
                console.log('receivers receiver i guess: ' + receiver.$cstNode?.text)
                console.log(receiver.$type)
                console.log('receivers member: ' + call.receiver.member?.$cstNode?.text)
                console.log(call.receiver.member?.$type)
                */
                if (isSdsReference(receiver)){
                    const newHldr = receiver.target.ref;
                    if(!isSdsPlaceholder(newHldr)) { return; }
                    this.checkIfArgumentIsAssigneeOfSpecificFunction(
                        newHldr, 
                        functionCallName,
                        correctAssigneePosition,
                        services, results
                    )
                }
            }
            
        }
        const args = call.argumentList.arguments;
        if (!args) { return; }
        
        for (const arg of args){
            // Argument is a reference to a placeholder
            if (isSdsReference(arg.value)){
                if (!isSdsDeclaration(arg.value.target.ref)){ continue; }
                
                const newHldr = arg.value.target.ref;
                if(!isSdsPlaceholder(newHldr)) { return; }
                this.checkIfArgumentIsAssigneeOfSpecificFunction(
                    newHldr, 
                    functionCallName, 
                    correctAssigneePosition, 
                    services, results
                );
            }
            // Argument is a call
            else if (isSdsCall(arg.value)){
                const argRefCll = arg.value;
                if (argRefCll.argumentList?.arguments) {
                    // Get all arguments of the call and recursively call on these arguments as well
                    for (const newArg of argRefCll.argumentList.arguments){
                        if (!isSdsReference(newArg.value)) { continue; }
                        if (!isSdsDeclaration(newArg.value.target.ref)){ continue; }
                        
                        const newHldr = newArg.value.target.ref;
                        if(!isSdsPlaceholder(newHldr)) { return; }
                        this.checkIfArgumentIsAssigneeOfSpecificFunction(
                            newHldr, 
                            functionCallName, 
                            correctAssigneePosition, 
                            services, results
                        );
                    }
                }
            }
            else { 
                // MAYBE NEED TO HANDLE SdsList TOO! COULD HAVE NONPRIMITIVE TYPES
                /*
                // debug print
                console.log(arg.value.$cstNode?.text)
                console.log('arg.value is in fact ' + arg.value.$type); 
                */
                continue; 
            }
        }
    }
}



class BackwardSliceAggregator {
    private readonly purityComputer: SafeDsPurityComputer;

    /**
     * The statements that are needed to calculate the target statements.
     */
    readonly statements: SdsStatement[] = [];

    /**
     * The placeholders that are needed to calculate the target statements.
     */
    readonly referencedPlaceholders: Set<SdsPlaceholder>;

    /**
     * The impurity reasons of the collected statements.
     */
    readonly impurityReasons: ImpurityReason[] = [];

    constructor(purityComputer: SafeDsPurityComputer) {
        this.purityComputer = purityComputer;

        this.referencedPlaceholders = new Set();
    }

    addStatement(statement: SdsStatement): void {
        this.statements.unshift(statement);

        // Remember all referenced placeholders
        this.getReferencedPlaceholders(statement).forEach((it) => {
            this.referencedPlaceholders.add(it);
        });

        // Remember all impurity reasons
        this.purityComputer.getImpurityReasonsForStatement(statement).forEach((it) => {
            this.impurityReasons.push(it);
        });
    }

    addStatementWithoutPurity(statement: SdsStatement): void {
        this.statements.unshift(statement);

        // Remember all referenced placeholders
        this.getReferencedPlaceholders(statement).forEach((it) => {
            this.referencedPlaceholders.add(it);
        });
    }

    private getReferencedPlaceholders(node: SdsStatement): Stream<SdsPlaceholder> {
        return AstUtils.streamAllContents(node).flatMap((it) => {
            if (isSdsReference(it) && isSdsPlaceholder(it.target.ref)) {
                return [it.target.ref];
            } else {
                return [];
            }
        });
    }
}
