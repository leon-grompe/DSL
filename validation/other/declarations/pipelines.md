# Validations from "pipelines.ts"

pipelinesMustBePrivate 
    node: SdsPipeline
    'error', 'Pipelines are always private and cannot be declared as internal.'
    CODE_PIPELINE_VISIBILITY
    -
    'info', 'Pipelines are always private and need no explicit visibility modifier.'
    CODE_PIPELINE_VISIBILITY


## Assessment
Possible. Delete visibility modifier.