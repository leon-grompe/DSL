import { ValidationAcceptor } from 'langium';
import { isSdsClass, isSdsFunction, SdsAnnotatedObject, SdsPipeline } from '../../generated/ast.js';
import { SafeDsServices } from '../../index.js';

export const CODE_PIPELINE_BEHAVIOUR_PROTOCOL = 'pipeline/behaviour-protocol';

export const pipelineMustFollowBehaviourProtocol = (services: SafeDsServices) => {
    const nodeMapper = services.helpers.NodeMapper;
    const builtinAnnotations = services.builtins.Annotations;

    return (node: SdsPipeline, accept: ValidationAcceptor) => {
        const phaseOrder = [
            'DataAcquisition', 'DataPreparation', 'DataPreprocessing', 
            'FeatureEngineering', 'FeatureSelection', 'Modeling', 'Training', 'Prediction', 'Evaluation', 'Testing',
            'Interpretation'
        ];
        let currentPhase = -1;
        // operatoren:
        // sequenz, wiederholung, alternative
        /*
        phases = []
        -> alles was gleichzeitig kann, kommt in ein array
        -> wenn etwas passieren muss: muss das beim traversieren gecheckt werden?
        */
        const statements = node.body.statements;
        
        for (const statement of statements) {            
            const call = nodeMapper.statementToCall(statement);
            if (!call) continue;

            const callable = nodeMapper.callToCallable(call);
            if (!callable || !(isSdsFunction(callable) || isSdsClass(callable))) continue;

            const phase = builtinAnnotations.getDSPipelinePhase(callable as SdsAnnotatedObject);
            if (!phase) continue;
            console.log(`Found phase annotation '${phase.name}' on function '${callable.name}'`);
            
            const phaseIndex = phaseOrder.indexOf(phase.name);
            if (phaseIndex < 0) continue;
            console.log(`Phase '${phase.name}' has index ${phaseIndex} in the phase order`);
            console.log(`Current phase index is ${currentPhase}`);
            
            if (phaseIndex < currentPhase) {
                accept('warning',
                    `Function '${callable.name}' is annotated with phase '${phase.name}' but occurs after phase '${phaseOrder[currentPhase]}'.`,
                    {
                        node: call,
                        code: CODE_PIPELINE_BEHAVIOUR_PROTOCOL,
                    },
                );
            } else {
                currentPhase = phaseIndex;
            };
        };
    };
};

export interface Phase {
    name: string;
}

export abstract class ProtocolBlock {
    constructor(){}

    abstract validate(sequence: Phase[], startIndex: number) : [boolean, number];
}
export class ElementaryBlock extends ProtocolBlock{
    constructor(
        public phase: string,

    ){ super() }

    validate(sequence: Phase[], startIndex: number) : [boolean, number] {

        return [false, startIndex];
    }
}

export class SequenceBlock extends ProtocolBlock{
    constructor(
        public blocks: ProtocolBlock[],
    ){ super() }

    validate(sequence: Phase[], startIndex: number) : [boolean, number] {

        return [false, startIndex];
    }
}   

export class RepetitionBlock extends ProtocolBlock{
    constructor(
        public block: ProtocolBlock,
        public min: number = 0,
        public max: number = Infinity,

    ){ super() }

    validate(sequence: Phase[], startIndex: number) : [boolean, number] {

        return [false, startIndex];
    }
}

export class AlternativeBlock extends ProtocolBlock{
    constructor(
        public blocks: ProtocolBlock[],
        public relation: 'or' | 'xor',
    ){ super() }

    validate(sequence: Phase[], startIndex: number) : [boolean, number] {

        return [false, startIndex];
    }
}

const protocol = new SequenceBlock([
    new RepetitionBlock(
        new ElementaryBlock('DataAcquisitionQGeneral'),
        1
    ),
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock('EditImageList'),
            new ElementaryBlock('AcquisitionAndEngineering'),
            new ElementaryBlock('DataAcquisitionQGeneral')],
            'or'
        )
    ),
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock('DataPreparationQGeneral'),
            new ElementaryBlock('Exploration'),
            new ElementaryBlock('EditImageList'),
            new ElementaryBlock('PreparationAndEngineering'),
            new ElementaryBlock('PreparationPreprocessingAndEngineering')],
            'or'
        )
    ),
    new RepetitionBlock(
        new ElementaryBlock('DataPartitioningQGeneral'),
        1
    ),
])

