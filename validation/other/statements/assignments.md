# Validations from "assignments.ts"

assignmentAssigneeMustGetValue 
    node: SdsAssignment
    'error', 'No value is assigned to this assignee.'
    CODE_ASSIGMENT_NOTHING_ASSIGNED


assignmentShouldNotImplicitlyIgnoreResult 
    node: SdsAssignment
    'warning', "The assignment implicitly ignores the ${kind} ${names}."
    CODE_ASSIGNMENT_IMPLICITLY_IGNORED_RESULT


yieldMustNotBeUsedInPipeline
    node: SdsYield
    'error', 'Yield must not be used in a pipeline.'
    CODE_ASSIGMENT_YIELD_FORBIDDEN_IN_PIPELINE


## Assignment
Unsure