# Validations from "segments.ts"

segmentResultMustBeAssignedExactlyOnce 
    node: SdsSegment
    'error', 'Nothing is assigned to this result.'
    CODE_SEGMENT_UNASSIGNED_RESULT
    -
    'error', "The result '${result.name}' has been assigned already."
    CODE_SEGMENT_DUPLICATE_YIELD


segmentParameterShouldBeUsed 
    node: SdsSegment
    'warning', 'This parameter is unused and can be removed.'
    CODE_SEGMENT_UNUSED_PARAMETER


## Assessment
Partially possible. Unsure about first case