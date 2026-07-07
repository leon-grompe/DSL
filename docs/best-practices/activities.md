# Activities

Many functions in the integrated API are tagged with one or more **activities** via the `@PipelineActivity` annotation. 
An activity belongs to one or multiple [phases](ds-workflow.md) which describe where in a Pipeline the activity should be situated.

## Activity naming

Activity names follow the pattern `PhaseQType`, where the letter `Q` separates the [phase](ds-workflow.md#pipeline-layers) from the activity type. For
example, `DataAcquisitionQDataLoading` is the *Data Loading* activity of the *Data Acquisition* phase.

The same activity *type* can appear in several phases. *Exploration*, for instance, exists both before the split (as
`DataPreparationQExploration`) and after it (as `DataProcessingQExploration`). The table below lists each activity type
once, together with the phases it appears in and what it does.

## Activity reference

| Activity | Phases | Description |
|----------|--------|-------------|
| `DataLoading` | Data Acquisition | Import data from external files. |
| `DatatypeConstruction` | Data Acquisition, Feature Engineering | Build data by hand (e.g. a `Table` or `Column`). |
| `Utilities` | Data Acquisition, Data Preparation, Data Processing, Feature Engineering | Helper operations for many different contexts. |
| `Exploration` | Data Preparation, Data Processing | Exploratory data analysis (statistics, plots, …). |
| `PreSplitCleaning` | Data Preparation | Deterministic pre-split cleaning (row removal). |
| `SchemaModification` | Data Preparation, Data Processing, Feature Engineering, Feature Selection | Change the column structure (rename/add/remove, join). |
| `DataSplitting` | Data Partitioning | Split the dataset into training, test, and (optionally) validation sets. |
| `PostSplitCleaning` | Data Processing | Distribution-based cleaning (row removal). |
| `DataTransformation` | Data Processing | Transform existing values with transformers (scale, impute). |
| `Engineering` | Feature Engineering | Derive or add new feature columns. |
| `FeatureTransformation` | Feature Engineering | Create new feature representations with transformers (encode, discretize). |
| `TabularDatasetConversion` | Feature Selection | Convert a table into a tabular dataset and choose target and features. |
| `ModelCreation` | Modeling | Construct a model or network layers. |
| `ModelFitting` | Training | Train the model on the training set. |
| `Prediction` | Evaluation, Testing | Run the model on held-out data and predict the target column. |
| `MetricCalculation` | Evaluation, Testing | Compute numeric performance scores. |
| `PostProcessing` | Interpretation | Post-process features to derive information (inverse-transform feature columns). |
| `Visualization` | Interpretation | Plot the model. |

## Rules for partitioned data

After splitting the data into training/validation/test sets, some activities should only ever touch a specific set. 
Applying them to the wrong one risks [data leakage](common-errors.md).

| Phase | Activity | Allowed set |
|-------|----------|-------------------|
| Data Processing | Data transformation, schema modification, utilities | Any set |
| Data Processing | Exploration, post-split cleaning | Training set |
| Evaluation | Prediction, metric calculation | Validation set |
| Testing | Prediction, metric calculation | Test set |


The **training** set is the only set where exploration and training are allowed, since these are operations that require looking at the data. And you must not look at data that your model will later be judged
The reason exploration and cleaning are training-only is that these are decisions you make by looking at the data, and you 
must not make them by looking at data the model will later be judged on.

The **validation** set is used during *Evaluation* for hyperparameter tuning. It is the set you are allowed to look at repeatedly to attempt to achieve better results.

The **test** set is used *only once* during *Testing* to estimate how the model generalizes to unseen data. When you make a modeling decision based on the test score, that score stops being an honest estimate of generality.

## See also

- [Pipeline Structure](ds-workflow.md) — how these activities are ordered into phases and layers.
- [API by Activity](../api/by-activity.md) — a lookup of every API operation grouped by the activity it performs.