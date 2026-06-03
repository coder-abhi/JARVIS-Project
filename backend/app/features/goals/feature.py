from .. import FeatureDefinition
from .router import router

feature = FeatureDefinition(key="goals", name="Goals cockpit", router=router, depends_on=("auth", "projects", "tasks"))
