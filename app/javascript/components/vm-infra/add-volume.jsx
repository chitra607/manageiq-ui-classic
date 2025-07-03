// app/javascript/components/vm-kubevirt/add-volume.jsx-------------xx
import React, { useState, useEffect, useMemo } from "react";
import PropTypes from "prop-types";
import { Grid } from "carbon-components-react";
import MiqFormRenderer from "../../forms/data-driven-form";
import { API } from "../../http_api";
import createSchema from "./add-volume.schema";
import miqRedirectBack from "../../helpers/miq-redirect-back";

const AddVolumeForm = ({ recordId, redirect }) => {
  const [state, setState] = useState({
    isLoading: true,
    volumes: [],
  });

  const [isSubmitDisabled, setSubmitDisabled] = useState(true);

  useEffect(() => {
    const fetchPersistentVolumeClaims = async () => {
      try {
        setState(prev => ({ ...prev, isLoading: true, error: null }));

        // Use the correct route for your Rails controller
        const response = await fetch(`/vm_infra/${recordId}/persistentvolumeclaims`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error((data.error && data.error.message) || 'Failed to fetch persistent volume claims');
        }

        setState(prev => ({
          ...prev,
          isLoading: false,
          volumes: data.resources || [],
          vmInfo: {
            name: data.vm_name,
            namespace: data.vm_namespace
          }
        }));
      } catch (error) {
        console.error('Error fetching PVCs:', error);
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: error.message,
          volumes: []
        }));
      }
    };

  fetchPersistentVolumeClaims();
}, [recordId]);

  const schema = useMemo(() => createSchema(state.volumes), [state.volumes]);

  const onFormChange = (values) => {
    if (values.volumeSourceType === "existing") {
      setSubmitDisabled(!values.pvcName);
    } else if (values.volumeSourceType === "new") {
      setSubmitDisabled(!values.newVolumeName || !values.newVolumeSize);
    } else {
      setSubmitDisabled(true);
    }
  };

  const onSubmit = (values) => {
    const { volumeSourceType } = values;

    let payload;

    if (volumeSourceType === "existing") {
      const volumeNameFinal =
        values.volumeName && values.volumeName.trim()
          ? values.volumeName.trim()
          : values.pvcName;

      payload = {
        action: "add_volume",
        resource: {
          pvc_name: values.pvcName,
          volume_name: volumeNameFinal,
        },
      };
    } else {
      payload = {
        action: "create_and_attach_volume",
        resource: {
          volume_name: values.newVolumeName.trim(),
          volume_size: values.newVolumeSize.trim(),
        },
      };
    }

    fetch(`/vm_infra/${recordId}/add_volume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(async (response) => {
        const data = await response.json();

        if (!response.ok || data.success === false) {
          const msg = data.error || data.message || __("Failed to process volume");
          throw new Error(msg);
        }

        miqRedirectBack(__("Volume processed successfully"), "success", redirect);
      })
      .catch((error) => {
        miqRedirectBack(error.message || __("Failed to process volume"), "error", redirect);
      });
  };

  const onCancel = () =>
    miqRedirectBack(__("Add Volume was cancelled by the user"), "warning", redirect);

  return state.isLoading ? null : (
    <Grid>
      <MiqFormRenderer
        schema={schema}
        onSubmit={onSubmit}
        onCancel={onCancel}
        canSubmit={!isSubmitDisabled}
        onStateUpdate={onFormChange}
      />
    </Grid>
  );
};

AddVolumeForm.propTypes = {
  recordId: PropTypes.string.isRequired,
  redirect: PropTypes.string.isRequired,
};

export default AddVolumeForm;
