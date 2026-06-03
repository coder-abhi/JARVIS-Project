from .. import FeatureDefinition
from .router import router

feature = FeatureDefinition(key="ai", name="AI wrapper status", router=router)
