# Common Mistakes

## Data leakage

One of the most common mistakes is *data leakage*. This mistake occurs when information from the test data flows,
directly or indirectly, into the training process. The result is an overly optimistic offline evaluation: the model
looks strong on test data but performs worse in production.

Generally, there are three kinds of data leakage relevant for Safe-DS:

- **Preprocessing leakage:** Transformations such as scaling, normalization, PCA, or feature selection are fitted on the
  whole dataset before splitting, so information about the test distribution leaks into training.

    *Avoid this by splitting first and computing all transformation parameters only on the training data.*

- **Overlap leakage:** Rows of the test set overlap with the training set, for example through oversampling/augmentation
  or duplication before the split.

    *Avoid this by splitting first, and applying augmentation operations only on the training data.*

- **Multi-test leakage:** The same test data is used repeatedly for decisions like model selection or hyperparameter
  tuning, so it is effectively no longer independent test data.

    *Avoid this by splitting into three data sets ([learn more here](pipeline-structure.md#the-three-datasets)) and
    use the validation set for all development decisions and only touch the test set once at the very end to assess the
    generality of your model.*

These problems can be solved rather easily by splitting the data correctly. Learn more about data partitioning
[here](pipeline-structure.md#the-three-datasets).

## Overfitting

Another common mistake is *model overfitting*. This occurs when a model is tuned so closely to a specific dataset that it
captures its idiosyncrasies instead of the underlying pattern, and therefore generalizes poorly.

- **Too little data:** A common cause for overfitting is having too little training data.

    *Avoid this by augmenting your training data.*

- **Choosing a wrong model:** Choosing a complex model for rather simple data may lead to the model learning the noise
  instead of just the signal.

    *Avoid this by understanding your data and choosing your model carefully.*

- **Sequential overfitting:** Another cause is repeatedly using the test set to guide model selection, so it gradually
  becomes part of the training process (similar to multi-test leakage; see [Data leakage](#data-leakage)).

    *Avoid this by making development decisions on a validation set, keeping a separate hold-out test set that is used
    only once, and being cautious about over-interpreting small performance differences, especially when many models or
    configurations are compared.*

## Insufficient preprocessing

A third common mistake is *insufficient preprocessing*, jumping into modeling without properly understanding and
preparing the data. Two aspects matter in particular:

- **Skipping exploratory data analysis (EDA):** Not performing any EDA means missing distributions, outliers, class
  imbalance, or biased/unrepresentative samples that will later distort the model.

    *Avoid this by taking the time to explore and understand the data and domain, and checking that the training data
    actually represents the target population.*

- **Omitting data cleaning:** Not performing data cleaning leaves missing values, duplicates, and inconsistent encodings
  in place, so the model learns artifacts rather than real relationships ("garbage in, garbage out").

    *Decide on strategies like imputation or basic removal to handle missing data, and consider outlier and duplicate
    handling based on the domain.*

## Unsuitable evaluation

Finally, a common mistake is *unsuitable evaluation*, in particular choosing the wrong metric. Accuracy is the classic
pitfall on imbalanced classes: with a 90/10 split, a model that always predicts the majority class reaches 90 % accuracy
while being useless.

*Avoid this by choosing metrics that fit the problem (e.g. F1, precision/recall, ROC-AUC, or MCC for imbalanced data),
and weighing the real cost of false positives versus false negatives for your specific domain.*


## Read more

- Lones, M. A. (2024). *Avoiding common machine learning pitfalls.* Patterns, 5(10), 101046.
  <https://doi.org/10.1016/j.patter.2024.101046>
- Yang, C., Brower-Sinning, R. A., Lewis, G., & Kästner, C. (2022). *Data leakage in notebooks: Static detection and
  better processes.* In Proceedings of the 37th IEEE/ACM International Conference on Automated Software Engineering
  (ASE '22), 1–12. <https://doi.org/10.1145/3551349.3556918>
