from .. import FeatureDefinition
from .router import router

feature = FeatureDefinition(key="tasks", name="Tasks and assignment", router=router, depends_on=("auth", "projects"))
