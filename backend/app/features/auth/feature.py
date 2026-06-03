from .. import FeatureDefinition
from .router import router

feature = FeatureDefinition(key="auth", name="Local authentication", router=router)
