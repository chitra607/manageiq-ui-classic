import React, { useState, useEffect, useMemo } from "react";
import PropTypes from "prop-types";
import { Grid } from "carbon-components-react";
import { API } from "../../http_api";
import MiqFormRenderer from "../../forms/data-driven-form";
import miqRedirectBack from "../../helpers/miq-redirect-back";
import createDetachSchema from "./remove-volume.schema";

const DetachVolumeForm = ({ recordId, redirect }) => {
  const [state, setState] = useState({
    isLoading: true,
    volumes: [],
  });

  const [isSubmitDisabled, setSubmitDisabled] = useState(true);

  useEffect(() => {
    const fetchVolumes = async () => {
      try {
        setState(prev => ({ ...prev, isLoading: true, error: null }));

        const response = await fetch(`/vm_infra/${recordId}/attached_volumes`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error((data.error && data.error.message) || 'Failed to fetch attached volumes');
        }

        setState(prev => ({
          ...prev,
          isLoading: false,
          volumes: data.resources || [],
        }));
      } catch (error) {
        console.error('Error fetching volumes:', error);
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: error.message,
          volumes: []
        }));
      }
    };

    fetchVolumes();
  }, [recordId]);

  const schema = useMemo(() => createDetachSchema(state.volumes), [state.volumes]);

  const onFormChange = (values) => {
    setSubmitDisabled(!values.volumeName);
  };

  const onSubmit = (values) => {
    const payload = {
      action: "remove_volume",
      resource: {
        volume_name: values.volumeName.trim(),
      },
    };

    fetch(`/vm_infra/${recordId}/remove_volume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then((response) => {
        if (!response.ok) throw new Error("Failed to detach volume");
        return response.json();
      })
      .then(() => {
        miqRedirectBack(__("Volume detached successfully"), "success", redirect);
      })
      .catch((error) => {
        miqRedirectBack(error.message || __("Failed to detach volume"), "error", redirect);
      });
  };

  const onCancel = () =>
    miqRedirectBack(__("Detach Volume was cancelled by the user"), "warning", redirect);

  return state.isLoading ? null : (
    <Grid>
      <MiqFormRenderer
        schema={schema}
        onSubmit={onSubmit}
        onCancel={onCancel}
        canSubmit={!isSubmitDisabled}
        onStateUpdate={onFormChange}
        buttonsLabels={{ submitLabel: __("Detach") }}
      />
    </Grid>
  );
};

DetachVolumeForm.propTypes = {
  recordId: PropTypes.string.isRequired,
  redirect: PropTypes.string.isRequired,
};

export default DetachVolumeForm;
