from .. import FeatureDefinition

feature = FeatureDefinition(key="pomodoro", name="Pomodoro desktop workflow", router=None, depends_on=("auth", "projects", "tasks"))
