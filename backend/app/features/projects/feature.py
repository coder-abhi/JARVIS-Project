from .. import FeatureDefinition
from .router import router

feature = FeatureDefinition(key="projects", name="Projects dashboard", router=router, depends_on=("auth",))
