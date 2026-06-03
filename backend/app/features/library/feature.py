from .. import FeatureDefinition
from .router import router

feature = FeatureDefinition(key="library", name="Reading library", router=router, depends_on=("auth",))
